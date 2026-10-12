import { PixelRect, ScreensaverImage, coverPixels, snapToDevicePixels } from 'common/screensaver';
import { ScreensaverImages } from './images';

/** One screen that the screensaver draws on: a window of its own that covers a monitor */
export interface ScreenSurface {
  /**
   * The window. Timers and animations are started on this one: the main window is covered while the
   * screensaver runs, and the browser slows down everything in a window that cannot be seen.
   */
  win: Window;
  /** Fills the window */
  root: HTMLElement;
  /** In CSS pixels */
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface Timing {
  duration: number;
  delay?: number;
  easing?: string;
}

/** Runs a function, and gives up waiting for it after a while */
export function withTimeout<T>(win: Window, promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const handle = win.setTimeout(() => reject(new Error('Took too long')), ms);
    promise.then(
      (value) => {
        win.clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        win.clearTimeout(handle);
        reject(error);
      },
    );
  });
}

export function wait(win: Window, ms: number): Promise<void> {
  return new Promise((resolve) => win.setTimeout(resolve, ms));
}

/**
 * An image on a screen: a frame, and in it a canvas with the image drawn at exactly the number of device
 * pixels it covers, with every edge on a whole device pixel. Nothing is scaled while it stands still, which
 * is what keeps it sharp.
 *
 * Only `transform` and `opacity` are ever animated. Those are handled by the graphics card without laying
 * out or painting anything again, so the motion does not stutter. A change of size is animated by scaling
 * the frame, with the canvas scaled the other way so that the image is not squeezed.
 */
export class ImageTile {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: ImageBitmapRenderingContext | null;
  /** Where it is, or is moving to */
  frame: PixelRect = { x: 0, y: 0, width: 1, height: 1, pixelWidth: 1, pixelHeight: 1 };
  /** The image inside the frame, in device pixels */
  private content = { width: 1, height: 1, left: 0, top: 0 };
  /** Goes up with every change of size: a bitmap that arrives for an older size is thrown away */
  private drawVersion = 0;
  private isDisposed = false;

  constructor(
    private readonly surface: ScreenSurface,
    readonly image: ScreensaverImage,
    private readonly images: ScreensaverImages,
  ) {
    const doc = surface.root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'screensaver-tile';
    this.canvas = doc.createElement('canvas');
    this.renderer = this.canvas.getContext('bitmaprenderer');
    this.element.appendChild(this.canvas);
    // Not shown before it is told how
    this.element.style.visibility = 'hidden';
    surface.root.appendChild(this.element);
  }

  private get dpr(): number {
    return this.surface.devicePixelRatio;
  }

  /**
   * Puts it in a frame, without animation, and draws the image for it.
   * @returns When the image is there. Fails when the image cannot be drawn
   */
  place(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.setFrame(snapToDevicePixels(rect, this.dpr));
    return this.sharpen();
  }

  private setFrame(frame: PixelRect) {
    this.frame = frame;
    this.content = coverPixels(frame.pixelWidth, frame.pixelHeight, this.image.aspectRatio);
    const { dpr } = this;
    const { style } = this.element;
    style.width = `${frame.width}px`;
    style.height = `${frame.height}px`;
    style.transform = `translate(${frame.x}px, ${frame.y}px)`;
    const canvasStyle = this.canvas.style;
    canvasStyle.width = `${this.content.width / dpr}px`;
    canvasStyle.height = `${this.content.height / dpr}px`;
    canvasStyle.left = `${this.content.left / dpr}px`;
    canvasStyle.top = `${this.content.top / dpr}px`;
  }

  /** Draws the image at the size the frame has now. What was shown stays until the new one is there */
  private async sharpen(): Promise<void> {
    const version = ++this.drawVersion;
    const { width, height } = this.content;
    const bitmap = await this.images.draw(this.image, width, height);
    if (this.isDisposed || version !== this.drawVersion || this.renderer === null) {
      bitmap.close();
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer.transferFromImageBitmap(bitmap);
  }

  show(): void {
    this.element.style.visibility = '';
  }

  animate(keyframes: Keyframe[], timing: Timing): Animation {
    return this.element.animate(keyframes, {
      duration: timing.duration,
      delay: timing.delay ?? 0,
      easing: timing.easing ?? 'linear',
      // Looks like the first keyframe while waiting to start, and like its own style when done
      fill: 'backwards',
    });
  }

  /** Fades in where it is */
  appear(timing: Timing): Animation {
    this.show();
    return this.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }

  /** Fades away where it is, and stays invisible */
  fade(timing: Timing, toScale = 1): Animation {
    const { x, y, width, height } = this.frame;
    // Scaled around its middle
    const dx = (width * (1 - toScale)) / 2;
    const dy = (height * (1 - toScale)) / 2;
    const animation = this.animate(
      [
        { opacity: 1, transform: `translate(${x}px, ${y}px) scale(1)` },
        { opacity: 0, transform: `translate(${x + dx}px, ${y + dy}px) scale(${toScale})` },
      ],
      timing,
    );
    this.element.style.opacity = '0';
    return animation;
  }

  /** Comes in from somewhere else, at the size it has */
  enterFrom(x: number, y: number, timing: Timing): Animation {
    this.show();
    return this.animate(
      [
        { transform: `translate(${x}px, ${y}px)` },
        { transform: `translate(${this.frame.x}px, ${this.frame.y}px)` },
      ],
      timing,
    );
  }

  /** Moves away to somewhere else, at the size it has, and stays there */
  leaveTo(x: number, y: number, timing: Timing): Animation {
    const from = `translate(${this.frame.x}px, ${this.frame.y}px)`;
    const to = `translate(${x}px, ${y}px)`;
    const animation = this.animate([{ transform: from }, { transform: to }], timing);
    this.element.style.transform = to;
    return animation;
  }

  /**
   * Moves to another frame, which can have another size.
   * The frame gets its new size at once and is scaled back to look like the old one, the canvas is scaled
   * the opposite way, and both animate to no scaling at all. The image for the new size is drawn meanwhile.
   */
  moveTo(rect: { x: number; y: number; width: number; height: number }, timing: Timing): void {
    const next = snapToDevicePixels(rect, this.dpr);
    const old = this.frame;
    const oldContent = this.content;
    if (
      next.x === old.x &&
      next.y === old.y &&
      next.pixelWidth === old.pixelWidth &&
      next.pixelHeight === old.pixelHeight
    ) {
      return;
    }
    this.setFrame(next);
    const content = this.content;
    const { dpr } = this;

    const scaleX = old.width / next.width;
    const scaleY = old.height / next.height;
    this.animate(
      [
        { transform: `translate(${old.x}px, ${old.y}px) scale(${scaleX}, ${scaleY})` },
        { transform: `translate(${next.x}px, ${next.y}px) scale(1, 1)` },
      ],
      timing,
    );
    // Where the canvas was in the old frame, in the coordinates of the scaled new frame
    const fromX = oldContent.left / dpr / scaleX - content.left / dpr;
    const fromY = oldContent.top / dpr / scaleY - content.top / dpr;
    const fromScaleX = oldContent.width / content.width / scaleX;
    const fromScaleY = oldContent.height / content.height / scaleY;
    this.canvas.animate(
      [
        {
          transform: `translate(${fromX}px, ${fromY}px) scale(${fromScaleX}, ${fromScaleY})`,
        },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ],
      {
        duration: timing.duration,
        delay: timing.delay ?? 0,
        easing: timing.easing ?? 'linear',
        fill: 'backwards',
      },
    );

    if (content.width !== oldContent.width || content.height !== oldContent.height) {
      // When it fails the image that is there stays, a little less sharp
      this.sharpen().catch(() => undefined);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.element.remove();
    // Lets go of the bitmap
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/** The styles of everything the screensaver puts in a window */
export const SCREENSAVER_STYLES = `
  html, body {
    margin: 0;
    width: 100%;
    height: 100%;
    background: black;
    overflow: hidden;
    cursor: none;
    user-select: none;
  }
  .screensaver-root {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: black;
    cursor: none;
  }
  .screensaver-tile {
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    transform-origin: 0 0;
    will-change: transform, opacity;
    contain: strict;
    background: #0b0b0c;
  }
  .screensaver-tile canvas {
    position: absolute;
    display: block;
    transform-origin: 0 0;
    will-change: transform;
  }
  .screensaver-ambient {
    position: absolute;
    inset: -12%;
    will-change: opacity;
    contain: strict;
  }
  .screensaver-ambient canvas {
    display: block;
    width: 100%;
    height: 100%;
    filter: blur(48px) brightness(0.32) saturate(1.15);
  }
`;

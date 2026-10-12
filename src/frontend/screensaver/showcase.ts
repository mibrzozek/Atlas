import { ImagePool, ScreensaverImage, layoutShowcase } from 'common/screensaver';
import { ScreensaverImages } from './images';
import { ImageTile, ScreenSurface, Timing, wait, withTimeout } from './tile';

// The images that are shown fade away, and when they are nearly gone the next ones fade in, each a little
// after the other. Two sets of images in different places on top of each other look like a mistake, so
// they hardly overlap. The glow behind them fades over the whole time, which keeps the screen from going black
const FADE_OUT: Timing = { duration: 1500, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' };
const FADE_IN: Timing = { duration: 2000, delay: 1100, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' };
const FADE_IN_STAGGER = 260;
const GLOW_FADE: Timing = { duration: 2800, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' };
/** They come in very slightly enlarged and settle: at rest nothing is scaled, which keeps them sharp */
const SETTLE_SCALE = 1.018;
export const SHOWCASE_STEP_DURATION = (FADE_IN.delay ?? 0) + FADE_IN.duration + 2 * FADE_IN_STAGGER;
const DRAW_TIMEOUT = 8000;
/** The glow behind the images is a tiny copy of one of them, blurred: this many pixels is plenty */
const AMBIENT_PIXELS = 48;

/**
 * Shows a few images at a time, whole and as large as the screen allows, in front of a soft glow of
 * their colours, and fades over to the next ones. For when there are too few images for a wall.
 */
export class ShowcasePresenter {
  private tiles: ImageTile[] = [];
  private ambient: HTMLElement | undefined;
  private isDisposed = false;

  constructor(
    private readonly surface: ScreenSurface,
    private readonly pool: ImagePool<ScreensaverImage>,
    private readonly images: ScreensaverImages,
    private readonly groupSize: number,
  ) {}

  /** The images that are on this screen */
  get shown(): ScreensaverImage[] {
    return this.tiles.map((tile) => tile.image);
  }

  private layout(images: readonly ScreensaverImage[]) {
    const { width, height } = this.surface;
    const short = Math.min(width, height);
    return layoutShowcase(
      images.map((image) => image.aspectRatio),
      width,
      height,
      Math.round(short * 0.045),
      Math.round(short * 0.014),
    );
  }

  /**
   * Takes the next images from the pool: as many as look good together, which depends on their shapes.
   * @returns Nothing when every image is on a screen already
   */
  pick(): ScreensaverImage[] {
    const candidates: ScreensaverImage[] = [];
    for (let i = 0; i < this.groupSize; i++) {
      const image = this.pool.take();
      if (image === undefined) {
        break;
      }
      candidates.push(image);
    }
    const count = this.layout(candidates).length;
    candidates.slice(count).forEach((image) => this.pool.putBack(image));
    return candidates.slice(0, count);
  }

  /**
   * Fades over to the next images.
   * @returns false when there are none to change to
   */
  async step(): Promise<boolean> {
    // Again with other images when none of the picked ones could be drawn
    for (let attempt = 0; attempt < 4 && !this.isDisposed; attempt++) {
      const next = this.pick();
      if (next.length === 0) {
        return false;
      }
      if (await this.present(next)) {
        break;
      }
    }
    return true;
  }

  /**
   * Fades over to the given images.
   * @param keepOld The images that were shown stay in use: another screen is taking them over
   * @returns false when none of them could be drawn: what was shown stays
   */
  async present(next: readonly ScreensaverImage[], keepOld = false): Promise<boolean> {
    const { surface } = this;
    const rects = this.layout(next);
    const added: ImageTile[] = [];
    await Promise.all(
      rects.map(async (rect, i) => {
        const tile = new ImageTile(surface, next[i], this.images);
        try {
          await withTimeout(surface.win, tile.place(rect), DRAW_TIMEOUT);
          added[i] = tile;
        } catch (e) {
          console.warn('Screensaver: could not draw', next[i].src, e);
          tile.dispose();
          this.pool.remove(next[i]);
        }
      }),
    );
    // The ones that were picked but do not fit on this screen
    next.slice(rects.length).forEach((image) => this.pool.putBack(image));
    const tiles = added.filter((tile) => tile !== undefined);
    if (this.isDisposed || tiles.length === 0) {
      tiles.forEach((tile) => tile.dispose());
      return false;
    }
    const ambient = await this.createAmbient(tiles[0].image).catch(() => undefined);
    if (this.isDisposed) {
      tiles.forEach((tile) => tile.dispose());
      ambient?.remove();
      return false;
    }

    const old = this.tiles;
    const oldAmbient = this.ambient;
    this.tiles = tiles;
    this.ambient = ambient;

    old.forEach((tile) => tile.fade(FADE_OUT, 0.985));
    if (oldAmbient !== undefined) {
      oldAmbient.animate([{ opacity: 1 }, { opacity: 0 }], { ...GLOW_FADE, fill: 'forwards' });
    }
    if (ambient !== undefined) {
      // Underneath the images
      surface.root.insertBefore(ambient, surface.root.firstChild);
      ambient.animate([{ opacity: 0 }, { opacity: 1 }], { ...GLOW_FADE, fill: 'backwards' });
    }
    tiles.forEach((tile, i) => {
      const { x, y, width, height } = tile.frame;
      const dx = (width * (1 - SETTLE_SCALE)) / 2;
      const dy = (height * (1 - SETTLE_SCALE)) / 2;
      tile.show();
      tile.animate(
        [
          {
            opacity: 0,
            transform: `translate(${x + dx}px, ${y + dy}px) scale(${SETTLE_SCALE})`,
          },
          { opacity: 1, transform: `translate(${x}px, ${y}px) scale(1)` },
        ],
        { ...FADE_IN, delay: (FADE_IN.delay ?? 0) + i * FADE_IN_STAGGER },
      );
    });

    await wait(surface.win, SHOWCASE_STEP_DURATION + 100);
    oldAmbient?.remove();
    old.forEach((tile) => {
      tile.dispose();
      if (!keepOld && !this.isDisposed) {
        this.pool.release(tile.image);
        this.images.forget(tile.image);
      }
    });
    return true;
  }

  /** A blurred, darkened copy of the image that fills the screen behind the images */
  private async createAmbient(image: ScreensaverImage): Promise<HTMLElement> {
    const ratio = image.aspectRatio > 0 ? image.aspectRatio : 1.5;
    const width = ratio >= 1 ? AMBIENT_PIXELS : Math.max(8, Math.round(AMBIENT_PIXELS * ratio));
    const height = ratio >= 1 ? Math.max(8, Math.round(AMBIENT_PIXELS / ratio)) : AMBIENT_PIXELS;
    const bitmap = await withTimeout(
      this.surface.win,
      this.images.draw(image, width, height),
      DRAW_TIMEOUT,
    );
    const doc = this.surface.root.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'screensaver-ambient';
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap);
    element.appendChild(canvas);
    return element;
  }

  dispose(): void {
    this.isDisposed = true;
    this.tiles.forEach((tile) => {
      tile.dispose();
      this.pool.release(tile.image);
    });
    this.tiles = [];
    this.ambient?.remove();
  }
}

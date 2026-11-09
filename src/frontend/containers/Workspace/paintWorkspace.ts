import { Crop } from 'common/crop';
import {
  Rect,
  TEXT_LINE_HEIGHT,
  WorkspaceBackgroundItem,
  WorkspaceTextItem,
} from 'common/workspace';
import { TEXT_FONT_WEIGHT } from './measureText';

/**
 * Drawing what is on a workspace into a canvas, as the page shows it: what a saved picture and the frames
 * of a video are made of. Places are given in pixels of the canvas.
 */
export class WorkspacePainter {
  private readonly style: CSSStyleDeclaration;
  private readonly fontFamily: string;

  constructor(
    readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    /** Where the workspace is drawn: colours of the theme (`var(--...)`) are looked up there */
    themeOf: HTMLElement,
  ) {
    this.style = getComputedStyle(themeOf);
    this.fontFamily = getComputedStyle(document.body).fontFamily;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
  }

  /** A colour as CSS writes it, with those of the theme looked up */
  colorOf(color: string, fallback: string): string {
    const name = /^var\((--[\w-]+)\)$/.exec(color)?.[1];
    return (name !== undefined ? this.style.getPropertyValue(name).trim() : color) || fallback;
  }

  fill(color: string, at: Rect): void {
    this.context.fillStyle = this.colorOf(color, '#000000');
    this.context.fillRect(at.x, at.y, at.width, at.height);
  }

  background(item: WorkspaceBackgroundItem, at: Rect): void {
    this.context.fillStyle = this.colorOf(item.color, '#ffffff');
    this.context.fillRect(at.x, at.y, at.width, at.height);
  }

  /** A text in `ink` (a colour, or the theme's text colour when empty), its letters as large as `at` is */
  text(item: WorkspaceTextItem, at: Rect, ink: string | undefined): void {
    const { context } = this;
    const fontSize = item.fontSize * (at.width / item.width);
    context.fillStyle = this.colorOf(
      ink ?? '',
      this.style.getPropertyValue('--text-color').trim() || '#000',
    );
    context.font = `${TEXT_FONT_WEIGHT} ${fontSize}px ${this.fontFamily}`;
    context.textBaseline = 'middle';
    item.text.split('\n').forEach((line, i) => {
      context.fillText(line, at.x, at.y + (i + 0.5) * fontSize * TEXT_LINE_HEIGHT);
    });
  }

  /** The part `crop` of a photo (as fractions of it), drawn into `at` */
  image(source: CanvasImageSource & { width: number; height: number }, crop: Crop, at: Rect): void {
    this.context.drawImage(
      source,
      crop.x * source.width,
      crop.y * source.height,
      crop.width * source.width,
      crop.height * source.height,
      at.x,
      at.y,
      at.width,
      at.height,
    );
  }
}

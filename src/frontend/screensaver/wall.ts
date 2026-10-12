import {
  ImagePool,
  LaneOrientation,
  LanePlacement,
  ScreensaverImage,
  layoutLanes,
} from 'common/screensaver';
import { ScreensaverImages } from './images';
import { ImageTile, ScreenSurface, Timing, wait, withTimeout } from './tile';

/** The space between the images, in pixels: the same as in the gallery */
export const WALL_GAP = 8;

// A step: the first image slowly fades away, then the others move up to fill its place
const FADE: Timing = { duration: 1800, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' };
const MOVE: Timing = { duration: 1500, delay: 1500, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' };
export const WALL_STEP_DURATION = Math.max(FADE.duration, (MOVE.delay ?? 0) + MOVE.duration);
/** All images fade in when it starts, one a little after the other */
const APPEAR: Timing = { duration: 1400, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' };
const APPEAR_STAGGER = 45;
/** How long to wait for an image to be drawn before going on without it */
const DRAW_TIMEOUT = 8000;

export interface WallOptions {
  orientation: LaneOrientation;
  laneCount: number;
}

/**
 * Fills a screen with images, and lets them move through it like a snake: the first image fades away,
 * the others of its lane move up, the first image of every next lane comes in at the end of the lane
 * before it, and an image that was not shown yet comes in at the very end.
 */
export class WallPresenter {
  /** The images in the order they move through the screen: the ones that are shown, then the next ones */
  private sequence: ScreensaverImage[] = [];
  /** By image and lane. An image that moves to another lane gets a new tile, which comes in at its end */
  private tiles = new Map<string, ImageTile>();
  private isDisposed = false;

  constructor(
    private readonly surface: ScreenSurface,
    private readonly pool: ImagePool<ScreensaverImage>,
    private readonly images: ScreensaverImages,
    private readonly options: WallOptions,
  ) {}

  private get isRows(): boolean {
    return this.options.orientation === 'rows';
  }

  /**
   * Lays out the start of the sequence over the screen.
   * The layout looks a few images further than it shows: those are taken from the pool as they are needed.
   */
  private layout(): LanePlacement[] {
    const { surface, options, pool, sequence } = this;
    const placements = layoutLanes(
      (index) => {
        while (index >= sequence.length) {
          const next = pool.take();
          if (next === undefined) {
            return NaN;
          }
          sequence.push(next);
        }
        return sequence[index].aspectRatio;
      },
      0,
      {
        orientation: options.orientation,
        laneCount: options.laneCount,
        laneLength: this.isRows ? surface.width : surface.height,
        crossLength: this.isRows ? surface.height : surface.width,
        gap: WALL_GAP,
      },
    );
    // No image left for the last places: they stay empty
    return placements.filter((p) => p.sequenceIndex < sequence.length);
  }

  private keyOf(placement: LanePlacement): string {
    return `${this.sequence[placement.sequenceIndex].id}:${placement.lane}`;
  }

  private drop(image: ScreensaverImage) {
    this.sequence = this.sequence.filter((other) => other !== image);
    this.pool.remove(image);
    this.images.forget(image);
  }

  /**
   * Makes tiles for the places that have none yet, with their image drawn, without showing them.
   * An image that cannot be drawn is taken out and the screen is laid out again without it.
   */
  private async prepare(): Promise<{ placements: LanePlacement[]; added: Map<string, ImageTile> }> {
    const added = new Map<string, ImageTile>();
    for (let attempt = 0; attempt < 6; attempt++) {
      const placements = this.layout();
      const failed: ScreensaverImage[] = [];
      await Promise.all(
        placements.map(async (placement) => {
          const key = this.keyOf(placement);
          if (this.tiles.has(key) || added.has(key)) {
            return;
          }
          const image = this.sequence[placement.sequenceIndex];
          const tile = new ImageTile(this.surface, image, this.images);
          added.set(key, tile);
          try {
            await withTimeout(this.surface.win, tile.place(placement), DRAW_TIMEOUT);
          } catch (e) {
            console.warn('Screensaver: could not draw', image.src, e);
            failed.push(image);
          }
        }),
      );
      if (failed.length === 0 || this.isDisposed) {
        return { placements, added };
      }
      // Without the failed images everything that comes after them gets another place: start over.
      // That is quick, the images that could be drawn are still decoded
      added.forEach((tile) => tile.dispose());
      added.clear();
      failed.forEach((image) => this.drop(image));
    }
    return { placements: [], added };
  }

  /** Shows the first screen of images */
  async start(): Promise<void> {
    const { placements, added } = await this.prepare();
    if (this.isDisposed) {
      added.forEach((tile) => tile.dispose());
      return;
    }
    placements.forEach((placement, i) => {
      const key = this.keyOf(placement);
      const tile = added.get(key);
      if (tile !== undefined) {
        this.tiles.set(key, tile);
        tile.appear({ ...APPEAR, delay: i * APPEAR_STAGGER });
      }
    });
  }

  /** Whether there is an image waiting to come in */
  get canStep(): boolean {
    return (
      this.tiles.size > 0 && (this.sequence.length > this.tiles.size || this.pool.freeCount > 0)
    );
  }

  /** Moves everything one image further. Resolves when the screen stands still again */
  async step(): Promise<void> {
    if (this.isDisposed || !this.canStep) {
      return;
    }
    const first = this.sequence.shift();
    if (first === undefined) {
      return;
    }
    const { placements, added } = await this.prepare();
    if (this.isDisposed) {
      added.forEach((tile) => tile.dispose());
      return;
    }
    if (placements.length === 0) {
      // Nothing could be drawn: leave the screen as it is
      this.sequence.unshift(first);
      return;
    }
    const { surface, isRows } = this;
    const wanted = new Map(placements.map((p) => [this.keyOf(p), p]));

    // The ones that have no place any more
    const gone: ImageTile[] = [];
    for (const [key, tile] of this.tiles) {
      if (wanted.has(key)) {
        continue;
      }
      this.tiles.delete(key);
      gone.push(tile);
      if (tile.image === first) {
        // The first of all fades away where it is
        tile.fade(FADE, 0.97);
      } else {
        // Out of the start of its lane, while it comes in at the end of the lane before it
        tile.leaveTo(
          isRows ? -tile.frame.width - WALL_GAP : tile.frame.x,
          isRows ? tile.frame.y : -tile.frame.height - WALL_GAP,
          MOVE,
        );
      }
    }
    for (const [key, placement] of wanted) {
      const existing = this.tiles.get(key);
      if (existing !== undefined) {
        existing.moveTo(placement, MOVE);
        continue;
      }
      const tile = added.get(key);
      if (tile !== undefined) {
        this.tiles.set(key, tile);
        // From just outside the screen, at the end of its lane
        tile.enterFrom(
          isRows ? surface.width + WALL_GAP : tile.frame.x,
          isRows ? tile.frame.y : surface.height + WALL_GAP,
          MOVE,
        );
      }
    }

    await wait(surface.win, WALL_STEP_DURATION + 100);
    gone.forEach((tile) => tile.dispose());
    if (!this.isDisposed) {
      this.pool.release(first);
      this.images.forget(first);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.tiles.forEach((tile) => tile.dispose());
    this.tiles.clear();
    this.sequence.forEach((image) => this.pool.release(image));
    this.sequence = [];
  }
}

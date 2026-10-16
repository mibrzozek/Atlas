import fse from 'fs-extra';

/**
 * Tiny versions of the images of a workspace, for drawing them on its canvas when they are small on
 * screen: zoomed out, thousands of images are a few pixels each, and an element for each would make every
 * frame slow. Read and decoded outside the main thread (`fs` and `createImageBitmap` on a blob), several
 * at a time, and kept for as long as there is room.
 *
 * They are prepared for the whole workspace in the background (`prepare`), also while it is not on
 * screen; what is on screen right now (`get`) goes first.
 */

/** Images get an element of their own from 48 pixels on: their tile is never drawn much larger */
const TILE_WIDTH = 48;
/** About 6 KB each: 12,000 is some 70 MB */
export const MAX_TILES = 12000;
const MAX_LOADING = 8;

export class TileImages {
  private paths = new Map<string, string>();
  /** Least recently used first */
  private readonly tiles = new Map<string, ImageBitmap>();
  private readonly failed = new Set<string>();
  private readonly loading = new Set<string>();
  /** On screen now; forgotten with every frame */
  private readonly urgent: string[] = [];
  /** The rest of the workspace, in the background */
  private background: string[] = [];
  private isDisposed = false;
  /** Called when a tile is there: the surface on screen draws it */
  onLoad: ((id: string) => void) | undefined;

  constructor(private readonly onPrepared: (id: string) => void) {}

  /** Where the images are on disk: their thumbnails, or the files themselves when small enough */
  setPaths(paths: ReadonlyMap<string, string>): void {
    this.paths = new Map(paths);
  }

  /** Loads the tiles of these images in the background; `onPrepared` is called for each */
  prepare(ids: readonly string[]): void {
    // Tried again: a thumbnail that was missing may have been made since
    this.failed.clear();
    const wanted = ids.slice(0, MAX_TILES);
    this.background = [];
    for (const id of wanted) {
      if (this.tiles.has(id) || this.failed.has(id) || !this.paths.has(id)) {
        this.onPrepared(id);
      } else {
        this.background.push(id);
      }
    }
    // The first ones first
    this.background.reverse();
    this.loadNext();
  }

  /** The tile of an image if it is there, without asking for it */
  peek(id: string): ImageBitmap | undefined {
    return this.tiles.get(id);
  }

  /** The tile of an image, or nothing yet: then it is loaded before the others */
  get(id: string): ImageBitmap | undefined {
    const tile = this.tiles.get(id);
    if (tile !== undefined) {
      // Most recently used goes to the end
      this.tiles.delete(id);
      this.tiles.set(id, tile);
      return tile;
    }
    if (!this.loading.has(id) && !this.failed.has(id) && this.paths.has(id)) {
      this.urgent.push(id);
      this.loadNext();
    }
    return undefined;
  }

  /** What was asked for in an earlier frame and is not on screen anymore is not loaded first anymore */
  forgetUrgent(): void {
    this.urgent.length = 0;
  }

  dispose(): void {
    this.isDisposed = true;
    this.urgent.length = 0;
    this.background = [];
    this.tiles.forEach((tile) => tile.close());
    this.tiles.clear();
  }

  private loadNext() {
    while (this.loading.size < MAX_LOADING) {
      // The last asked for first: that is what is on screen now
      const id = this.urgent.pop() ?? this.background.pop();
      if (id === undefined) {
        return;
      }
      if (this.loading.has(id) || this.tiles.has(id) || this.failed.has(id)) {
        continue;
      }
      this.loading.add(id);
      this.load(id).finally(() => {
        this.loading.delete(id);
        if (!this.isDisposed) {
          this.onPrepared(id);
          this.loadNext();
        }
      });
    }
  }

  private async load(id: string) {
    const path = this.paths.get(id);
    if (path === undefined) {
      return;
    }
    try {
      const data = await fse.readFile(path);
      const tile = await createImageBitmap(new Blob([data]), {
        resizeWidth: TILE_WIDTH,
        resizeQuality: 'medium',
      });
      if (this.isDisposed) {
        tile.close();
        return;
      }
      this.tiles.set(id, tile);
      for (const [oldId, oldTile] of this.tiles) {
        if (this.tiles.size <= MAX_TILES) {
          break;
        }
        oldTile.close();
        this.tiles.delete(oldId);
      }
      this.onLoad?.(id);
    } catch {
      this.failed.add(id);
    }
  }
}

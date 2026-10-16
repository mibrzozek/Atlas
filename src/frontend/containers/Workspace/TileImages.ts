import fse from 'fs-extra';

import type { TileRow } from '../../../backend/workspace-db';

/**
 * Tiny versions of the images of a workspace, for drawing them on its canvas when they are small on
 * screen: zoomed out, thousands of images are a few pixels each, and an element for each would make every
 * frame slow. Read and decoded outside the main thread (`fs` and `createImageBitmap` on a blob), several
 * at a time, and kept for as long as there is room.
 *
 * They are prepared for the whole workspace in the background (`prepare`), also while it is not on
 * screen; what is on screen right now (`get`) goes first. Once made, each is kept in the database with
 * the average colour of the image (`TileCache`), for all workspaces: after a restart a large workspace
 * reads them back instead of decoding every thumbnail again, and shows the colours at once.
 */

/** Images get an element of their own from 48 pixels on: their tile is never drawn much larger */
const TILE_WIDTH = 48;
/** About 6 KB each: 12,000 is some 70 MB */
export const MAX_TILES = 12000;
const MAX_LOADING = 8;
/** Tiles that were made are stored this many at once, or after this long */
const SAVE_BATCH = 200;
const SAVE_DELAY = 2000;

/** Where tiles are kept between runs: the workspaces database */
export interface TileCache {
  fetchTiles(fileIds: string[]): Promise<(TileRow | undefined)[]>;
  saveTiles(rows: TileRow[]): Promise<void>;
}

/** Where an image is read from (its thumbnail, or the file itself), and when the file last changed */
export interface TileSource {
  path: string;
  version: string;
}

export class TileImages {
  private sources = new Map<string, TileSource>();
  /** Least recently used first */
  private readonly tiles = new Map<string, ImageBitmap>();
  /** The average colour of each image whose tile was made, now or in an earlier run */
  private readonly colors = new Map<string, string>();
  /** Tiles kept from an earlier run, not decoded yet */
  private readonly kept = new Map<string, Blob>();
  private readonly failed = new Set<string>();
  private readonly loading = new Set<string>();
  /** On screen now; forgotten with every frame */
  private readonly urgent: string[] = [];
  /** The rest of the workspace, in the background */
  private background: string[] = [];
  /** Made, waiting to be stored */
  private unsaved: TileRow[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private isDisposed = false;
  /** Called when a tile is there: the surface on screen draws it */
  onLoad: ((id: string) => void) | undefined;
  /** Called when colours of images were read: the surface draws them where there is no tile yet */
  onColors: (() => void) | undefined;

  constructor(
    private readonly onPrepared: (id: string) => void,
    private readonly cache: TileCache,
  ) {}

  /** Where the images are on disk, and when their files last changed */
  setSources(sources: ReadonlyMap<string, TileSource>): void {
    this.sources = new Map(sources);
  }

  /**
   * Loads the tiles of these images in the background; `onPrepared` is called for each. What was kept
   * from an earlier run is read first, all at once: its colours can be drawn right away.
   */
  async prepare(ids: readonly string[]): Promise<void> {
    // Tried again: a thumbnail that was missing may have been made since
    this.failed.clear();
    const wanted = ids.slice(0, MAX_TILES);
    await this.readKept(wanted.filter((id) => !this.tiles.has(id) && this.sources.has(id)));
    if (this.isDisposed) {
      return;
    }
    this.background = [];
    for (const id of wanted) {
      if (this.tiles.has(id) || this.failed.has(id) || !this.sources.has(id)) {
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

  /** The average colour of an image, when its tile was ever made */
  colorOf(id: string): string | undefined {
    return this.colors.get(id);
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
    if (!this.loading.has(id) && !this.failed.has(id) && this.sources.has(id)) {
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
    this.saveMade();
    this.tiles.forEach((tile) => tile.close());
    this.tiles.clear();
    this.kept.clear();
  }

  /** The tiles kept from an earlier run that are still of the same file, and their colours */
  private async readKept(ids: string[]) {
    if (ids.length === 0) {
      return;
    }
    try {
      const rows = await this.cache.fetchTiles(ids);
      rows.forEach((row, i) => {
        const id = ids[i];
        if (row !== undefined && row.version === this.sources.get(id)?.version) {
          this.kept.set(id, row.image);
          this.colors.set(id, row.color);
        }
      });
      this.onColors?.();
    } catch (e) {
      console.error('Could not read the kept tiles', e);
    }
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
    const source = this.sources.get(id);
    if (source === undefined) {
      return;
    }
    try {
      const kept = this.kept.get(id);
      this.kept.delete(id);
      // The kept one; one that can not be read anymore is made again
      let tile =
        kept !== undefined ? await createImageBitmap(kept).catch(() => undefined) : undefined;
      const isMade = tile === undefined;
      tile ??= await createImageBitmap(new Blob([await fse.readFile(source.path)]), {
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
      if (isMade) {
        await this.keep(id, source.version, tile);
      }
    } catch {
      this.failed.add(id);
    }
  }

  /** A tile that was made, with the average colour of its image, to be stored */
  private async keep(id: string, version: string, tile: ImageBitmap) {
    const canvas = new OffscreenCanvas(tile.width, tile.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(tile, 0, 0);
    // The average of all its pixels (some 2,000): scaled down to one pixel, the browser only samples a few
    const { data } = context.getImageData(0, 0, tile.width, tile.height);
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
    }
    const count = data.length / 4;
    const color = `rgb(${sum.map((channel) => Math.round(channel / count)).join(', ')})`;
    const image = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    this.colors.set(id, color);
    this.unsaved.push({ fileId: id, version, color, image });
    if (this.unsaved.length >= SAVE_BATCH) {
      this.saveMade();
    } else if (this.saveTimer === undefined) {
      this.saveTimer = setTimeout(() => this.saveMade(), SAVE_DELAY);
    }
  }

  private saveMade() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const rows = this.unsaved;
    this.unsaved = [];
    if (rows.length > 0) {
      this.cache.saveTiles(rows).catch((e) => console.error('Could not keep the tiles', e));
    }
  }
}

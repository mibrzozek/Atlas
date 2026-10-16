import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';

import { ID } from '../../../api/id';
import { ClientWorkspace } from '../../entities/Workspace';
import type WorkspaceStore from '../../stores/WorkspaceStore';
import type { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { MAX_TILES, TileImages } from './TileImages';

/** How often the progress is passed on: not for each of thousands of images */
const PROGRESS_INTERVAL = 100;

/**
 * What a workspace needs to show its images: where each one is, and a tiny version of each for when they
 * are small on screen. Prepared in the background as soon as the workspace is made or opened, also while
 * the Library is in front, and kept while switching tabs. `progress` tells how far it got.
 */
export class WorkspaceImages {
  @observable.ref sources: ReadonlyMap<ID, WorkspaceImageSource> = new Map();
  /** How many of the images are prepared, of how many; undefined when there is nothing going on */
  @observable progress: { done: number; total: number } | undefined = undefined;
  readonly tiles: TileImages;
  private pending = new Set<string>();
  private done = 0;
  private progressTimer: ReturnType<typeof setTimeout> | undefined;
  /** Which preparing is the latest: an earlier one that finishes later is ignored */
  private generation = 0;
  private isDisposed = false;
  private readonly stopFollowing: () => void;

  constructor(private readonly store: WorkspaceStore, readonly workspace: ClientWorkspace) {
    this.tiles = new TileImages(this.handlePrepared);
    makeObservable(this);
    // Whenever images are added or taken off
    this.stopFollowing = reaction(
      () => workspace.fileIds.join(),
      () => this.prepare(),
      { fireImmediately: true },
    );
  }

  @computed get isPreparing(): boolean {
    return this.progress !== undefined;
  }

  dispose(): void {
    clearTimeout(this.progressTimer);
    this.stopFollowing();
    this.tiles.dispose();
  }

  private async prepare() {
    const generation = ++this.generation;
    const ids = this.workspace.fileIds;
    // Only the images that were added since: the others are known, and their tiles are kept
    const known = this.sources;
    const added = ids.filter((id) => !known.has(id));
    if (added.length === 0) {
      return;
    }
    const wanted = added.slice(0, MAX_TILES);
    this.done = 0;
    runInAction(() => (this.progress = { done: 0, total: wanted.length }));
    try {
      const found = await this.store.fetchImageSources(added);
      // Another preparing started in the meantime, or the workspace went: that one counts, or none
      if (generation !== this.generation || this.isDisposed) {
        return;
      }
      const sources = new Map([...this.sources, ...found]);
      this.tiles.setPaths(new Map([...sources].map(([id, source]) => [id, source.path])));
      runInAction(() => (this.sources = sources));
      this.pending = new Set(wanted);
      this.tiles.prepare(wanted);
    } catch (e) {
      console.error('Could not find the images of the workspace', e);
    }
    this.finishWhenDone();
  }

  private handlePrepared = (id: string) => {
    if (this.pending.delete(id)) {
      this.done++;
      if (this.pending.size === 0) {
        this.finishWhenDone();
      } else if (this.progressTimer === undefined) {
        this.progressTimer = setTimeout(this.passOnProgress, PROGRESS_INTERVAL);
      }
    }
  };

  private passOnProgress = action(() => {
    this.progressTimer = undefined;
    if (this.progress !== undefined) {
      this.progress = { done: this.done, total: this.progress.total };
    }
  });

  @action private finishWhenDone() {
    if (this.pending.size === 0) {
      clearTimeout(this.progressTimer);
      this.progressTimer = undefined;
      this.progress = undefined;
    }
  }
}

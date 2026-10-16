import { action, computed, makeObservable, observable, runInAction } from 'mobx';

import { moveItem, uniqueName } from 'common/collections';
import { encodeFilePath, getThumbnailPath } from 'common/fs';
import { notEmpty } from 'common/core';
import {
  addGroup,
  MeasureText,
  START_CAMERA,
  WorkspaceImage,
  WorkspaceItem,
  WorkspaceLayout,
  workspaceFromRow,
} from 'common/workspace';
import { DataStorage } from '../../api/data-storage';
import { generateId, ID } from '../../api/id';
import { WorkspaceDatabase } from '../../backend/workspace-db';
import { WorkspaceImages } from '../containers/Workspace/WorkspaceImages';
import { measureText as measureInPage } from '../containers/Workspace/measureText';
import { ClientWorkspace } from '../entities/Workspace';
import RootStore from './RootStore';

/** How long after the camera stopped it is stored: it changes with every frame of a pan or zoom */
const CAMERA_SAVE_DELAY = 500;
/** From this many images on, making a workspace is asked about first: preparing them takes a while */
export const LARGE_WORKSPACE = 2000;
/** The images of this many workspaces are kept ready, the ones opened last */
const MAX_PREPARED = 3;

/** Where an image of a workspace is shown from, and what it is called */
export interface WorkspaceImageSource {
  /** The thumbnail, or the file itself when it is small enough to be its own thumbnail */
  path: string;
  /** The same, as a URL for an <img> */
  src: string;
  name: string;
  /** The image itself, for drawing it sharper than its thumbnail when it is large on screen */
  file: { id: ID; absolutePath: string; extension: string; width: number; height: number };
}

/** What the buttons above a workspace and the layers panel do to the surface on screen */
export interface WorkspaceSurfaceControls {
  fitEverything(): void;
  zoomToActualSize(): void;
  /** The camera glides to one image or text */
  lookAt(id: string): void;
  /** A new text in the middle of the view; returns its id */
  addText(): string | undefined;
  /** A sheet of paper under what is selected, or in the middle of the view */
  addBackground(): void;
}

/** The workspaces, in the order of their tabs. Stored in a database of their own (`workspace-db.ts`) */
class WorkspaceStore {
  private readonly backend: DataStorage;
  private readonly db: WorkspaceDatabase;
  private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  readonly rootStore: RootStore;

  readonly workspaceList = observable<ClientWorkspace>([]);
  /** The surface of the workspace that is open, while it is on screen */
  surface: WorkspaceSurfaceControls | undefined;
  /** The images of the workspaces that were opened last, ready or being prepared; first is oldest */
  private readonly prepared = observable.map<ID, WorkspaceImages>({}, { deep: false });
  /** A workspace of many images that is waiting to be confirmed */
  @observable largeWorkspaceRequest: { imageCount: number } | undefined = undefined;

  constructor(
    backend: DataStorage,
    db: WorkspaceDatabase,
    rootStore: RootStore,
    /** How wide texts are: measured in the page, with the font they are drawn in */
    readonly measureText: MeasureText = measureInPage,
  ) {
    this.backend = backend;
    this.db = db;
    this.rootStore = rootStore;
    makeObservable(this);
  }

  async init(): Promise<void> {
    try {
      const rows = (await this.db.fetchAll())
        .map((row) => workspaceFromRow(row, this.measureText))
        .filter(notEmpty);
      const workspaces = rows
        .sort((a, b) => a.index - b.index)
        .map((row, index) => new ClientWorkspace(this, { ...row, index }));
      runInAction(() => this.workspaceList.replace(workspaces));
    } catch (err) {
      console.error('Could not load workspaces', err);
    }
  }

  /** A new workspace, after the others, with a batch of images for each thing it was made from */
  @action.bound async create(
    batches: readonly {
      label: string;
      images: readonly WorkspaceImage[];
      layout?: WorkspaceLayout;
    }[],
  ): Promise<ClientWorkspace> {
    // Laid out before it exists: what it starts with is not a change that undo would take back
    let items: WorkspaceItem[] = [];
    const placed = new Set<string>();
    for (const { label, images, layout } of batches) {
      // An image is on a workspace once
      const newImages = images.filter((image) => !placed.has(image.fileId));
      newImages.forEach((image) => placed.add(image.fileId));
      if (newImages.length > 0) {
        items = addGroup(items, label, newImages, generateId(), this.measureText, layout);
      }
    }
    const workspace = new ClientWorkspace(this, {
      id: generateId(),
      name: uniqueName(
        'Workspace',
        this.workspaceList.map((w) => w.name),
      ),
      index: this.workspaceList.length,
      items,
      camera: START_CAMERA,
      isLocked: false,
    });
    this.workspaceList.push(workspace);
    await this.db.save(workspace.toRow());
    return workspace;
  }

  /**
   * A new workspace with the images the Library shows, opened. With many images it is asked about first
   * (`largeWorkspaceRequest`), and then made and prepared in the background while the Library stays.
   */
  @action.bound async createFromLibrary(): Promise<void> {
    const { fileList } = this.rootStore.fileStore;
    if (fileList.length >= LARGE_WORKSPACE) {
      this.largeWorkspaceRequest = { imageCount: fileList.length };
      return;
    }
    const workspace = await this.createOfLibrary();
    this.rootStore.uiStore.openWorkspace(workspace);
  }

  @action.bound async confirmLargeWorkspace(): Promise<void> {
    this.largeWorkspaceRequest = undefined;
    const workspace = await this.createOfLibrary();
    this.prepareImages(workspace);
  }

  @action.bound cancelLargeWorkspace(): void {
    this.largeWorkspaceRequest = undefined;
  }

  /** The images the Library shows, laid out as the Library shows them: rows, columns or a grid */
  private async createOfLibrary(): Promise<ClientWorkspace> {
    const { fileStore, uiStore } = this.rootStore;
    const images = fileStore.fileList.map((file) => ({
      fileId: file.id,
      width: file.width,
      height: file.height,
    }));
    const layout = uiStore.galleryLayout;
    const workspace = await this.create(
      images.length > 0 ? [{ label: fileStore.viewName, images, layout }] : [],
    );
    // Selected, so that Arrange can change at once how they are laid out (the crop, the spacing)
    workspace.selectMany(workspace.fileIds, false);
    return workspace;
  }

  /** Starts getting its images ready in the background, if they are not already */
  @action.bound prepareImages(workspace: ClientWorkspace): void {
    const images = this.prepared.get(workspace.id);
    // The one used last goes to the end
    this.prepared.delete(workspace.id);
    this.prepared.set(workspace.id, images ?? new WorkspaceImages(this, workspace));
    const openId = this.rootStore.uiStore.activeWorkspace?.id;
    for (const [id, old] of this.prepared) {
      if (this.prepared.size <= MAX_PREPARED) {
        break;
      }
      // Not the one on screen, also when others were made in the meantime
      if (id === openId) {
        continue;
      }
      old.dispose();
      this.prepared.delete(id);
    }
  }

  /** Its images, when they are prepared or being prepared */
  imagesOf(workspace: ClientWorkspace): WorkspaceImages | undefined {
    return this.prepared.get(workspace.id);
  }

  /** The images of a workspace that are being prepared right now, if any */
  @computed get preparing(): WorkspaceImages | undefined {
    return [...this.prepared.values()].find((images) => images.isPreparing);
  }

  /**
   * Where the images are shown from: the thumbnail, or the file itself when it is small enough to be its
   * own thumbnail. Read from the database as plain rows, without loading the images into the Library.
   */
  async fetchImageSources(fileIds: ID[]): Promise<Map<ID, WorkspaceImageSource>> {
    const files = await this.backend.fetchFilesByID(fileIds);
    const { imageLoader, uiStore } = this.rootStore;
    const thumbnailDirectory = runInAction(() => uiStore.thumbnailDirectory);
    return new Map(
      files.map((file) => {
        const path = imageLoader.needsThumbnail(file)
          ? getThumbnailPath(file.absolutePath, thumbnailDirectory)
          : file.absolutePath;
        const { id, absolutePath, extension, width, height } = file;
        return [
          file.id,
          {
            path,
            src: encodeFilePath(path),
            name: file.name,
            file: { id, absolutePath, extension, width, height },
          },
        ];
      }),
    );
  }

  @action.bound async remove(workspace: ClientWorkspace): Promise<void> {
    clearTimeout(this.pendingSaves.get(workspace.id));
    this.pendingSaves.delete(workspace.id);
    this.workspaceList.remove(workspace);
    this.prepared.get(workspace.id)?.dispose();
    this.prepared.delete(workspace.id);
    this.updateIndices();
    await this.db.remove(workspace.id);
  }

  /** Moves the workspace to the given place among the tabs */
  @action.bound move(workspace: ClientWorkspace, toIndex: number): void {
    const from = this.workspaceList.indexOf(workspace);
    if (from !== -1) {
      this.workspaceList.replace(moveItem(this.workspaceList, from, toIndex));
      this.updateIndices();
    }
  }

  save(workspace: ClientWorkspace): void {
    clearTimeout(this.pendingSaves.get(workspace.id));
    this.pendingSaves.delete(workspace.id);
    // A workspace that was closed in the meantime is not brought back
    if (this.workspaceList.includes(workspace)) {
      this.db.save(workspace.toRow()).catch(console.error);
    }
  }

  /** Stores the workspace once it has not changed for a moment */
  saveSoon(workspace: ClientWorkspace): void {
    clearTimeout(this.pendingSaves.get(workspace.id));
    this.pendingSaves.set(
      workspace.id,
      setTimeout(() => this.save(workspace), CAMERA_SAVE_DELAY),
    );
  }

  @action private updateIndices(): void {
    this.workspaceList.forEach((workspace, i) => workspace.setIndex(i));
  }
}

export default WorkspaceStore;

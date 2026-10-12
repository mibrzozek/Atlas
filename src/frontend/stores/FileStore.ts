import { shell } from 'electron';
import fse from 'fs-extra';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';

import {
  MAX_COLLAGE_IMAGES,
  applyCollageOrder,
  collageKey,
  moveInCollage,
  swapInCollage,
} from 'common/collage';
import { exportFilesToDirectory } from 'common/export';
import { getThumbnailPath } from 'common/fs';
import { ScreensaverImage } from 'common/screensaver';
import { promiseAllLimit } from 'common/promise';
import { debounce } from 'common/timeout';
import { DataStorage } from '../../api/data-storage';
import { ConditionDTO, OrderBy, OrderDirection } from '../../api/data-storage-search';
import { FileDTO, IMG_EXTENSIONS_TYPE } from '../../api/file';
import { ID } from '../../api/id';
import { RendererMessenger } from '../../ipc/renderer';
import { AppToaster } from '../components/Toaster';
import { ThumbnailTarget } from '../image/ThumbnailGeneration';
import { ClientFile, mergeMovedFile } from '../entities/File';
import { ClientLocation } from '../entities/Location';
import { ClientStringSearchCriteria, ClientTagSearchCriteria } from '../entities/SearchCriteria';
import { ClientTag } from '../entities/Tag';
import RootStore from './RootStore';

export const FILE_STORAGE_KEY = 'Allusion_File';
/** The formats the browser shows without converting them first */
const WEB_EXTENSIONS = new Set<string>([
  'jpg',
  'jpeg',
  'jfif',
  'png',
  'apng',
  'webp',
  'gif',
  'bmp',
]);
const ROTATED_DIMENSIONS_FIXED_KEY = 'Atlas_RotatedDimensionsFixed';
const COLLAGE_MODE_KEY = 'Atlas_CollageMode';
/** How long the images take to glide to their places when collage mode is switched. Longer than the CSS transition */
export const COLLAGE_ANIMATION_DURATION = 1100;
/** Followed by the key of the view: the ids of its images in the order made by hand */
const COLLAGE_ORDER_KEY_PREFIX = 'Atlas_CollageOrder:';
const ROTATED_DIMENSIONS_PROGRESS_KEY = 'Atlas_RotatedDimensionsProgress';

/** These fields are stored and recovered when the application opens up */
type PersistentPreferenceFields = 'orderDirection' | 'orderBy';

const enum Content {
  All,
  Missing,
  Untagged,
  Query,
}

class FileStore {
  private readonly backend: DataStorage;
  private readonly rootStore: RootStore;

  readonly fileList = observable<ClientFile>([]);
  /**
   * The timestamp when the fileList was last modified.
   * Useful for in react component dependencies that need to trigger logic when the fileList changes
   */
  fileListLastModified = observable<Date>(new Date());
  /** A map of file ID to its index in the file list, for quick lookups by ID */
  private readonly index = new Map<ID, number>();

  private filesToSave: Map<ID, FileDTO> = new Map();

  /** The origin of the current files that are shown */
  @observable private content: Content = Content.All;
  @observable orderDirection: OrderDirection = OrderDirection.Desc;
  @observable orderBy: OrderBy<FileDTO> = 'dateAdded';
  @observable numTotalFiles = 0;
  @observable numUntaggedFiles = 0;
  @observable numMissingFiles = 0;
  /**
   * Collage mode: the images are shown in the order made by hand for this view, instead of sorted,
   * and can be dragged to another place
   */
  @observable isCollageMode =
    typeof localStorage !== 'undefined' && localStorage.getItem(COLLAGE_MODE_KEY) === 'true';
  /** For a moment after collage mode is switched on or off: the images glide to their new places */
  @observable isCollageAnimating = false;
  private collageAnimationTimeout: number | undefined;
  /** When collage mode was last switched (`performance.now()`): what was on screen is kept while it glides away */
  lastCollageToggle = -Infinity;
  /** When images were last moved by hand: the gallery must not scroll for that */
  lastCollageReorder = -Infinity;

  debouncedRefetch: () => void;
  debouncedSaveFilesToSave: () => Promise<void>;

  constructor(backend: DataStorage, rootStore: RootStore) {
    this.backend = backend;
    this.rootStore = rootStore;
    makeObservable(this);

    this.debouncedRefetch = debounce(this.refetch, 200).bind(this);
    this.debouncedSaveFilesToSave = debounce(this.saveFilesToSave, 100).bind(this);
  }

  @action.bound async readTagsFromFiles(): Promise<void> {
    const toastKey = 'read-tags-from-file';
    try {
      const numFiles = this.fileList.length;
      for (let i = 0; i < numFiles; i++) {
        AppToaster.show(
          {
            message: `Reading tags from files ${((100 * i) / numFiles).toFixed(0)}%...`,
            timeout: 0,
          },
          toastKey,
        );
        const file = runInAction(() => this.fileList[i]);

        const absolutePath = file.absolutePath;

        try {
          const tagsNameHierarchies = await this.rootStore.exifTool.readTags(absolutePath);

          // Now that we know the tag names in file metadata, add them to the files in Atlas
          // Main idea: Find matching tag with same name, otherwise, insert new
          //   for now, just match by the name at the bottom of the hierarchy

          const { tagStore } = this.rootStore;
          for (const tagHierarchy of tagsNameHierarchies) {
            const match = tagStore.findByName(tagHierarchy[tagHierarchy.length - 1]);
            if (match) {
              // If there is a match to the leaf tag, just add it to the file
              file.addTag(match);
            } else {
              // If there is no direct match to the leaf, insert it in the tag hierarchy: first check if any of its parents exist
              let curTag = tagStore.root;
              for (const nodeName of tagHierarchy) {
                const nodeMatch = tagStore.findByName(nodeName);
                if (nodeMatch) {
                  curTag = nodeMatch;
                } else {
                  curTag = await tagStore.create(curTag, nodeName);
                }
              }
              file.addTag(curTag);
            }
          }
        } catch (e) {
          console.error('Could not import tags for', absolutePath, e);
        }
      }
      AppToaster.show(
        {
          message: 'Reading tags from files... Done!',
          timeout: 5000,
        },
        toastKey,
      );
    } catch (e) {
      console.error('Could not read tags', e);
      AppToaster.show(
        {
          message: 'Reading tags from files failed. Check the dev console for more details',
          timeout: 5000,
        },
        toastKey,
      );
    }
  }

  @action.bound async writeTagsToFiles(): Promise<void> {
    const toastKey = 'write-tags-to-file';
    try {
      const numFiles = this.fileList.length;
      const tagFilePairs = runInAction(() =>
        this.fileList.map((f) => ({
          absolutePath: f.absolutePath,
          tagHierarchy: Array.from(
            f.tags,
            action((t) => t.path),
          ),
        })),
      );
      let lastToastVal = '0';
      for (let i = 0; i < tagFilePairs.length; i++) {
        const newToastVal = ((100 * i) / numFiles).toFixed(0);
        if (lastToastVal !== newToastVal) {
          lastToastVal = newToastVal;
          AppToaster.show(
            {
              message: `Writing tags to files ${newToastVal}%...`,
              timeout: 0,
            },
            toastKey,
          );
        }

        const { absolutePath, tagHierarchy } = tagFilePairs[i];
        try {
          await this.rootStore.exifTool.writeTags(absolutePath, tagHierarchy);
        } catch (e) {
          console.error('Could not write tags to', absolutePath, tagHierarchy, e);
        }
      }
      AppToaster.show(
        {
          message: 'Writing tags to files... Done!',
          timeout: 5000,
        },
        toastKey,
      );
    } catch (e) {
      console.error('Could not write tags', e);
      AppToaster.show(
        {
          message: 'Writing tags to files failed. Check the dev console for more details',
          timeout: 5000,
        },
        toastKey,
      );
    }
  }

  @computed get showsAllContent(): boolean {
    return this.content === Content.All;
  }

  @computed get showsUntaggedContent(): boolean {
    return this.content === Content.Untagged;
  }

  @computed get showsMissingContent(): boolean {
    return this.content === Content.Missing;
  }

  @computed get showsQueryContent(): boolean {
    return this.content === Content.Query;
  }

  @action.bound switchOrderDirection(): void {
    this.setOrderDirection(
      this.orderDirection === OrderDirection.Desc ? OrderDirection.Asc : OrderDirection.Desc,
    );
    this.refetch();
  }

  @action.bound orderFilesBy(prop: OrderBy<FileDTO> = 'dateAdded'): void {
    this.setOrderBy(prop);
    this.refetch();
  }

  /** Puts the images that are shown in a random order: a new one every time */
  @action.bound shuffle(): void {
    // The order made by hand would take the place of the random one
    if (this.isCollageMode) {
      this.setCollageMode(false);
    }
    this.orderFilesBy('random');
  }

  @action.bound setContentQuery(): void {
    this.content = Content.Query;
    if (this.rootStore.uiStore.isSlideMode) {
      this.rootStore.uiStore.disableSlideMode();
    }
  }

  @action.bound setContentAll(): void {
    this.content = Content.All;
    if (this.rootStore.uiStore.isSlideMode) {
      this.rootStore.uiStore.disableSlideMode();
    }
  }

  @action.bound setContentUntagged(): void {
    this.content = Content.Untagged;
    if (this.rootStore.uiStore.isSlideMode) {
      this.rootStore.uiStore.disableSlideMode();
    }
  }

  /**
   * Marks file as missing
   *
   * Marking a file as missing will remove the file from the FileStore stats and
   * automatically 'freezes' the object. Freezing means that changes made to a
   * file will not be saved in the database.
   * @param file
   */
  @action.bound hideFile(file: ClientFile): void {
    file.setBroken(true);
    this.rootStore.uiStore.deselectFile(file);
    this.incrementNumMissingFiles();
    if (file.tags.size === 0) {
      this.decrementNumUntaggedFiles();
    }
  }

  /** Replaces a file's data when it is moved or renamed */
  @action.bound replaceMovedFile(file: ClientFile, newData: FileDTO): void {
    const index = this.index.get(file.id);
    if (index !== undefined) {
      file.dispose();

      const newIFile = mergeMovedFile(file.serialize(), newData);

      // Move thumbnail
      const { thumbnailDirectory } = this.rootStore.uiStore; // TODO: make a config store for this?
      const oldThumbnailPath = file.thumbnailPath.replace('?v=1', '');
      const newThumbPath = getThumbnailPath(newData.absolutePath, thumbnailDirectory);
      fse.move(oldThumbnailPath, newThumbPath).catch(() => {});

      const newClientFile = new ClientFile(this, newIFile);
      newClientFile.thumbnailPath = newThumbPath;
      this.fileList[index] = newClientFile;
      this.save(newClientFile.serialize());
    }
  }

  /** Removes a file from the internal state of this store and the DB. Does not remove from disk. */
  @action async deleteFiles(files: ClientFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    try {
      // Remove from backend
      // Deleting non-exiting keys should not throw an error!
      await this.backend.removeFiles(files.map((f) => f.id));

      // Remove files from stores
      for (const file of files) {
        file.dispose();
        this.rootStore.uiStore.deselectFile(file);
        this.removeThumbnail(file.absolutePath);
      }
      this.fileListLastModified = new Date();
      return this.refetch();
    } catch (err) {
      console.error('Could not remove files', err);
    }
  }

  @action async deleteFilesByExtension(ext: IMG_EXTENSIONS_TYPE): Promise<void> {
    try {
      const crit = new ClientStringSearchCriteria('extension', ext, 'equals');
      const files = await this.backend.searchFiles(crit.toCondition(), 'id', OrderDirection.Asc);
      console.log('Files to delete', ext, files);
      await this.backend.removeFiles(files.map((f) => f.id));

      for (const file of files) {
        this.removeThumbnail(file.absolutePath);
      }
    } catch (e) {
      console.error('Could not delete files bye extension', ext);
    }
  }

  /** Asks for a folder and copies the given files into it. The originals are left untouched */
  async exportFilesToFolder(absolutePaths: string[]): Promise<void> {
    const toastKey = 'export-files';
    if (absolutePaths.length === 0) {
      AppToaster.show({ message: 'There are no images to export', timeout: 5000 }, toastKey);
      return;
    }
    const numFiles = absolutePaths.length;
    const { filePaths } = await RendererMessenger.showOpenDialog({
      title: `Choose a folder to export ${numFiles} image${numFiles === 1 ? '' : 's'} to`,
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (filePaths.length === 0) {
      return;
    }
    const targetDir = filePaths[0];

    try {
      let lastProgressUpdate = 0;
      const { copied, skipped, failed } = await exportFilesToDirectory(
        absolutePaths,
        targetDir,
        (numProcessed, total) => {
          if (Date.now() - lastProgressUpdate > 250) {
            lastProgressUpdate = Date.now();
            AppToaster.show(
              { message: `Exporting images... [${numProcessed} / ${total}]`, timeout: 0 },
              toastKey,
            );
          }
        },
      );
      const details = [
        skipped > 0 ? `${skipped} already in that folder` : '',
        failed.length > 0 ? `${failed.length} could not be copied` : '',
      ].filter(Boolean);
      AppToaster.show(
        {
          message: `Exported ${copied} image${copied === 1 ? '' : 's'}${
            details.length > 0 ? ` (${details.join(', ')})` : ''
          }`,
          timeout: failed.length > 0 ? 0 : 10000,
          clickAction: { label: 'Open folder', onClick: () => shell.openPath(targetDir) },
        },
        toastKey,
      );
    } catch (err) {
      console.error('Could not export files', err);
      AppToaster.show({ message: 'Could not export to that folder', timeout: 0 }, toastKey);
    }
  }

  /** Makes the dimensions of all files get checked again, e.g. after files were restored from a backup */
  static resetRotatedDimensionsFix(): void {
    localStorage.removeItem(ROTATED_DIMENSIONS_FIXED_KEY);
    localStorage.removeItem(ROTATED_DIMENSIONS_PROGRESS_KEY);
  }

  /**
   * Photos taken with the camera held sideways used to be stored with their width and height the wrong way around,
   * which made them show up cropped. This corrects the files that are already in the database, once.
   */
  async fixRotatedImageDimensions(): Promise<void> {
    const storageKey = ROTATED_DIMENSIONS_FIXED_KEY;
    if (localStorage.getItem(storageKey) !== null) {
      return;
    }
    // Where it left off, in case the application was closed before it was finished
    const progressKey = ROTATED_DIMENSIONS_PROGRESS_KEY;
    const toastKey = 'fix-rotated-dimensions';
    const CHUNK_SIZE = 500;
    const NUM_PARALLEL_CHUNKS = 4;
    const { exifTool } = this.rootStore;
    try {
      const progress: { lastId?: ID; numFixed: number } = JSON.parse(
        localStorage.getItem(progressKey) ?? '{"numFixed":0}',
      );
      const allFiles = await this.backend.fetchFiles('id', OrderDirection.Asc);
      const { lastId } = progress;
      const files = lastId === undefined ? allFiles : allFiles.filter((f) => f.id > lastId);
      const numDoneBefore = allFiles.length - files.length;
      let numFixed = progress.numFixed;

      const fixChunk = async (chunk: FileDTO[]): Promise<number> => {
        const dimensions = await exifTool.readRawDimensions(chunk.map((f) => f.absolutePath));
        const fixedFiles: FileDTO[] = [];
        for (const file of chunk) {
          const raw = dimensions.get(file.absolutePath);
          // Only when the stored dimensions have not been swapped yet
          if (
            raw !== undefined &&
            raw.isSideways &&
            raw.width !== raw.height &&
            file.width === raw.width &&
            file.height === raw.height
          ) {
            fixedFiles.push({ ...file, width: raw.height, height: raw.width });
          }
        }
        if (fixedFiles.length > 0) {
          await this.backend.saveFiles(fixedFiles);
          // Also the files that are loaded: otherwise they write their old dimensions back when they are saved
          for (const fixedFile of fixedFiles) {
            const clientFile = this.get(fixedFile.id);
            if (clientFile !== undefined) {
              clientFile.width = fixedFile.width;
              clientFile.height = fixedFile.height;
            }
          }
        }
        return fixedFiles.length;
      };

      const groupSize = CHUNK_SIZE * NUM_PARALLEL_CHUNKS;
      for (let i = 0; i < files.length; i += groupSize) {
        if (allFiles.length > CHUNK_SIZE) {
          AppToaster.show(
            {
              message: `Checking the orientation of your photos... [${numDoneBefore + i} / ${
                allFiles.length
              }]`,
              timeout: 0,
            },
            toastKey,
          );
        }
        const group = files.slice(i, i + groupSize);
        const chunks: FileDTO[][] = [];
        for (let j = 0; j < group.length; j += CHUNK_SIZE) {
          chunks.push(group.slice(j, j + CHUNK_SIZE));
        }
        const counts = await Promise.all(chunks.map(fixChunk));
        numFixed += counts.reduce((a, b) => a + b, 0);
        localStorage.setItem(
          progressKey,
          JSON.stringify({ lastId: group[group.length - 1].id, numFixed }),
        );
      }
      localStorage.setItem(storageKey, new Date().toISOString());
      localStorage.removeItem(progressKey);

      if (numFixed > 0) {
        // Lay out the shown images again with their corrected dimensions
        await this.refetch();
        AppToaster.show(
          {
            message: `Corrected ${numFixed} photos that were taken sideways: they are no longer cropped`,
            timeout: 10000,
          },
          toastKey,
        );
      } else {
        AppToaster.dismiss(toastKey);
      }
    } catch (err) {
      console.error('Could not correct the dimensions of rotated images', err);
      AppToaster.dismiss(toastKey);
    }
  }

  /**
   * All files in the library that have a thumbnail, as light-weight objects for generating those thumbnails
   * without having to load the files into the view.
   */
  async fetchThumbnailTargets(): Promise<ThumbnailTarget[]> {
    const files = await this.backend.fetchFiles('id', OrderDirection.Asc);
    const { imageLoader, uiStore } = this.rootStore;
    const thumbnailDirectory = runInAction(() => uiStore.thumbnailDirectory);
    const targets: ThumbnailTarget[] = [];
    for (const file of files) {
      if (imageLoader.needsThumbnail(file)) {
        targets.push({
          id: file.id,
          extension: file.extension,
          absolutePath: file.absolutePath,
          width: file.width,
          height: file.height,
          thumbnailPath: getThumbnailPath(file.absolutePath, thumbnailDirectory),
          setThumbnailPath: () => undefined,
        });
      }
    }
    return targets;
  }

  /**
   * The images of the home gallery for the screensaver, regardless of what is currently shown,
   * and without loading them into the view.
   * Many are shown at once, so their thumbnails are used: full-size photos would take far too much memory.
   */
  async fetchHomeGalleryImages(): Promise<ScreensaverImage[]> {
    const homeTag = runInAction(() => this.rootStore.tagStore.homeTag);
    if (homeTag === undefined) {
      return [];
    }
    const { imageLoader, uiStore } = this.rootStore;
    const thumbnailDirectory = runInAction(() => uiStore.thumbnailDirectory);
    const condition = new ClientTagSearchCriteria('tags', homeTag.id).toCondition(this.rootStore);
    const files = await this.backend.searchFiles(condition, 'id', OrderDirection.Asc);
    const images: ScreensaverImage[] = [];
    for (const file of files) {
      const isShownAsIs = WEB_EXTENSIONS.has(file.extension);
      const hasThumbnail = imageLoader.needsThumbnail(file);
      // Without a thumbnail, and without a format the browser can show, there is nothing to show
      if (isShownAsIs || hasThumbnail) {
        images.push({
          id: file.id,
          src: hasThumbnail
            ? getThumbnailPath(file.absolutePath, thumbnailDirectory)
            : file.absolutePath,
          fallbackSrc: isShownAsIs ? file.absolutePath : undefined,
          aspectRatio: file.width > 0 && file.height > 0 ? file.width / file.height : 1.5,
        });
      }
    }
    return images;
  }

  /** Exports all files that have any of the given tags or their sub-tags, regardless of what is currently shown */
  async exportTaggedFilesToFolder(tags: ClientTag[]): Promise<void> {
    try {
      const conditions = tags.map((tag) =>
        new ClientTagSearchCriteria('tags', tag.id).toCondition(this.rootStore),
      ) as [ConditionDTO<FileDTO>, ...ConditionDTO<FileDTO>[]];
      const files = await this.backend.searchFiles(conditions, 'id', OrderDirection.Asc, true);
      return this.exportFilesToFolder(files.map((file) => file.absolutePath));
    } catch (err) {
      console.error('Could not find the tagged files to export', err);
    }
  }

  @action.bound async refetch(): Promise<void> {
    if (this.showsAllContent) {
      return this.fetchAllFiles();
    } else if (this.showsUntaggedContent) {
      return this.fetchUntaggedFiles();
    } else if (this.showsQueryContent) {
      return this.fetchFilesByQuery();
    } else if (this.showsMissingContent) {
      return this.fetchMissingFiles();
    }
  }

  @action.bound async fetchAllFiles(): Promise<void> {
    try {
      this.rootStore.uiStore.clearSearchCriteriaList();
      const fetchedFiles = await this.backend.fetchFiles(this.orderBy, this.orderDirection);
      this.setContentAll();
      return this.updateFromBackend(fetchedFiles);
    } catch (err) {
      console.error('Could not load all files', err);
    }
  }

  @action.bound async fetchUntaggedFiles(): Promise<void> {
    try {
      const { uiStore } = this.rootStore;
      uiStore.clearSearchCriteriaList();
      const criteria = new ClientTagSearchCriteria('tags');
      uiStore.searchCriteriaList.push(criteria);
      const fetchedFiles = await this.backend.searchFiles(
        criteria.toCondition(this.rootStore),
        this.orderBy,
        this.orderDirection,
        uiStore.searchMatchAny,
      );
      this.setContentUntagged();
      return this.updateFromBackend(fetchedFiles);
    } catch (err) {
      console.error('Could not load all files', err);
    }
  }

  @action.bound async fetchMissingFiles(): Promise<void> {
    try {
      const {
        orderBy,
        orderDirection,
        rootStore: { uiStore },
      } = this;

      uiStore.searchCriteriaList.clear();
      this.setContentMissing();

      // Fetch all files, then check their existence and only show the missing ones
      // Similar to {@link updateFromBackend}, but the existence check needs to be awaited before we can show the images
      const backendFiles = await this.backend.fetchFiles(orderBy, orderDirection);

      // For every new file coming in, either re-use the existing client file if it exists,
      // or construct a new client file
      const [newClientFiles, reusedStatus] = this.filesFromBackend(backendFiles);

      // Dispose of unused files
      runInAction(() => {
        for (const oldFile of this.fileList) {
          if (!reusedStatus.has(oldFile.id)) {
            oldFile.dispose();
          }
        }
      });

      // We don't store whether files are missing (since they might change at any time)
      // So we have to check all files and check their existence them here
      const existenceCheckPromises = newClientFiles.map((clientFile) => async () => {
        clientFile.setBroken(!(await fse.pathExists(clientFile.absolutePath)));
      });

      const N = 50; // TODO: same here as in fetchFromBackend: number of concurrent checks should be system dependent
      await promiseAllLimit(existenceCheckPromises, N);

      runInAction(() => {
        const missingClientFiles = newClientFiles.filter((file) => file.isBroken);
        this.fileList.replace(missingClientFiles);
        this.numMissingFiles = missingClientFiles.length;
        this.index.clear();
        for (let index = 0; index < this.fileList.length; index++) {
          const file = this.fileList[index];
          this.index.set(file.id, index);
        }
        this.fileListLastModified = new Date();
      });
      this.cleanFileSelection();

      AppToaster.show(
        {
          message:
            'Some files can no longer be found. Either move them back to their source, or delete them from Atlas',
          timeout: 12000,
        },
        'recovery-view',
      );
    } catch (err) {
      console.error('Could not load broken files', err);
    }
  }

  @action.bound async fetchFilesByQuery(): Promise<void> {
    const { uiStore } = this.rootStore;

    if (uiStore.searchCriteriaList.length === 0) {
      return this.fetchAllFiles();
    }

    const criterias = uiStore.searchCriteriaList.map((c) => c.toCondition(this.rootStore));
    try {
      const fetchedFiles = await this.backend.searchFiles(
        criterias as [ConditionDTO<FileDTO>, ...ConditionDTO<FileDTO>[]],
        this.orderBy,
        this.orderDirection,
        uiStore.searchMatchAny,
      );
      this.setContentQuery();
      return this.updateFromBackend(fetchedFiles);
    } catch (e) {
      console.log('Could not find files based on criteria', e);
    }
  }

  @action.bound incrementNumUntaggedFiles(): void {
    this.numUntaggedFiles++;
  }

  @action.bound decrementNumUntaggedFiles(): void {
    if (this.numUntaggedFiles === 0) {
      throw new Error('Invalid Database State: Cannot have less than 0 untagged files.');
    }
    this.numUntaggedFiles--;
  }

  /////////////////// Collage mode ///////////////////

  /** What the current view is known by, for remembering its hand-made order */
  private get collageStorageKey(): string {
    const { uiStore } = this.rootStore;
    const content = this.showsQueryContent
      ? 'query'
      : this.showsUntaggedContent
      ? 'untagged'
      : this.showsMissingContent
      ? 'missing'
      : 'all';
    return (
      COLLAGE_ORDER_KEY_PREFIX +
      collageKey(
        content,
        uiStore.searchMatchAny,
        this.showsQueryContent
          ? uiStore.searchCriteriaList.map((c) => ({
              key: String(c.key),
              operator: c.operator,
              value: (c as { value?: unknown }).value,
            }))
          : [],
      )
    );
  }

  private readCollageOrder(): string[] {
    try {
      const stored = JSON.parse(localStorage.getItem(this.collageStorageKey) ?? '[]');
      return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Puts files in the hand-made order of the current view, when collage mode is on */
  private inCollageOrder<T extends { id: ID }>(files: T[]): T[] {
    if (!this.isCollageMode || files.length > MAX_COLLAGE_IMAGES) {
      return files;
    }
    const savedOrder = this.readCollageOrder();
    if (savedOrder.length === 0) {
      return files;
    }
    const byId = new Map(files.map((file) => [file.id, file]));
    return applyCollageOrder(
      files.map((file) => file.id),
      savedOrder,
    ).map((id) => byId.get(id) as T);
  }

  /** Whether the images of this view can be put in order by hand */
  @computed get canReorderCollage(): boolean {
    return this.isCollageMode && this.fileList.length <= MAX_COLLAGE_IMAGES;
  }

  /** Switches collage mode, and lets the gallery know that the images are on the move */
  @action private setCollageMode(isCollageMode: boolean): void {
    this.isCollageMode = isCollageMode;
    localStorage.setItem(COLLAGE_MODE_KEY, String(isCollageMode));
    this.lastCollageToggle = performance.now();
    this.isCollageAnimating = true;
    window.clearTimeout(this.collageAnimationTimeout);
    this.collageAnimationTimeout = window.setTimeout(
      action(() => (this.isCollageAnimating = false)),
      COLLAGE_ANIMATION_DURATION,
    );
  }

  @action.bound toggleCollageMode(): void {
    this.setCollageMode(!this.isCollageMode);
    if (this.isCollageMode && this.fileList.length > MAX_COLLAGE_IMAGES) {
      AppToaster.show(
        {
          message: `Collage mode puts up to ${MAX_COLLAGE_IMAGES} images in order by hand. Open a tag or a folder with fewer images to use it.`,
          timeout: 8000,
        },
        'collage',
      );
    }
    this.refetch();
  }

  /** Shows the loaded files in the given order, and remembers it for this view */
  @action private setCollageOrder(ids: string[]): void {
    const byId = new Map(this.fileList.map((file) => [file.id, file]));
    const files = ids.map((id) => byId.get(id)).filter((file): file is ClientFile => !!file);
    if (files.length !== this.fileList.length) {
      return;
    }
    // Every image has a place of the same size in collage mode: the others stay where they are,
    // and so does what part of the gallery is in view
    this.lastCollageReorder = performance.now();
    this.fileList.clear();
    this.fileList.push(...files);
    this.updateFileListState();
    this.fileListLastModified = new Date();
    try {
      localStorage.setItem(this.collageStorageKey, JSON.stringify(ids));
    } catch (e) {
      console.error('Could not remember the order of the collage', e);
      AppToaster.show(
        { message: 'The order could not be saved: there is no room left for it', timeout: 6000 },
        'collage',
      );
    }
  }

  /** Collage mode: moves images to right before or after another image */
  @action.bound moveFilesInCollage(
    moved: ClientFile[],
    target: ClientFile,
    place: 'before' | 'after',
  ): void {
    if (!this.canReorderCollage) {
      return;
    }
    const ids = this.fileList.map((file) => file.id);
    const newIds = moveInCollage(
      ids,
      moved.map((file) => file.id),
      target.id,
      place,
    );
    if (newIds.some((id, i) => id !== ids[i])) {
      this.setCollageOrder(newIds);
    }
  }

  /** Collage mode: puts two images in each other's place */
  @action.bound swapFilesInCollage(a: ClientFile, b: ClientFile): void {
    if (!this.canReorderCollage || a === b) {
      return;
    }
    this.setCollageOrder(
      swapInCollage(
        this.fileList.map((file) => file.id),
        a.id,
        b.id,
      ),
    );
  }

  /** Collage mode: switches the two selected images. Does nothing unless exactly two are selected */
  @action.bound swapSelectedFilesInCollage(): void {
    const { fileSelection } = this.rootStore.uiStore;
    if (fileSelection.size === 2) {
      const [a, b] = Array.from(fileSelection);
      this.swapFilesInCollage(a, b);
    }
  }

  // Removes all items from fileList
  @action.bound clearFileList(): void {
    this.fileList.clear();
    this.index.clear();
  }

  @action get(id: ID): ClientFile | undefined {
    const fileIndex = this.index.get(id);
    return fileIndex !== undefined ? this.fileList[fileIndex] : undefined;
  }

  getIndex(id: ID): number | undefined {
    return this.index.get(id);
  }

  getTags(ids: ID[]): Set<ClientTag> {
    const tags = new Set<ClientTag>();
    for (const id of ids) {
      const tag = this.rootStore.tagStore.get(id);
      if (tag !== undefined) {
        tags.add(tag);
      }
    }
    return tags;
  }

  getLocation(location: ID): ClientLocation {
    const loc = this.rootStore.locationStore.get(location);
    if (!loc) {
      throw new Error(
        `Location of file was not found! This should never happen! Location ${location}`,
      );
    }
    return loc;
  }

  save(file: FileDTO): void {
    // Save files in bulk so saving many files at once is faster.
    // Each file will call this save() method individually after detecting a change on its observable fields,
    // these can be batched by collecting the changes and debouncing the save operation
    this.filesToSave.set(file.id, file);
    this.debouncedSaveFilesToSave();
  }

  private async saveFilesToSave() {
    await this.backend.saveFiles(Array.from(this.filesToSave.values()));
    this.filesToSave.clear();
  }

  @action recoverPersistentPreferences(): void {
    const prefsString = localStorage.getItem(FILE_STORAGE_KEY);
    if (prefsString) {
      try {
        const prefs = JSON.parse(prefsString);
        // BACKWARDS_COMPATIBILITY: orderDirection used to be called fileOrder
        this.setOrderDirection(prefs.orderDirection ?? prefs.fileOrder);
        this.setOrderBy(prefs.orderBy);
      } catch (e) {
        console.error('Cannot parse persistent preferences:', FILE_STORAGE_KEY, e);
      }
    }
  }

  getPersistentPreferences(): Partial<Record<keyof FileStore, unknown>> {
    const preferences: Record<PersistentPreferenceFields, unknown> = {
      orderBy: this.orderBy,
      orderDirection: this.orderDirection,
    };
    return preferences;
  }

  clearPersistentPreferences(): void {
    localStorage.removeItem(FILE_STORAGE_KEY);
  }

  @action private async removeThumbnail(path: string) {
    const thumbnailPath = getThumbnailPath(path, this.rootStore.uiStore.thumbnailDirectory);
    try {
      if (await fse.pathExists(thumbnailPath)) {
        return fse.remove(thumbnailPath);
      }
    } catch (error) {
      // TODO: Show a notification that not all thumbnails could be removed?
      console.error(error);
    }
  }

  @action async updateFromBackend(backendFiles: FileDTO[]): Promise<void> {
    if (backendFiles.length === 0) {
      this.rootStore.uiStore.clearFileSelection();
      this.fileListLastModified = new Date();
      return this.clearFileList();
    }

    // Filter out images with hidden tags
    // TODO: could also do it in search query, this is simpler though (maybe also more performant)
    const hiddenTagIds = new Set(
      this.rootStore.tagStore.tagList.filter((t) => t.isHidden).map((t) => t.id),
    );
    backendFiles = backendFiles.filter((f) => !f.tags.some((t) => hiddenTagIds.has(t)));

    // In collage mode the order is the one made by hand for this view
    backendFiles = this.inCollageOrder(backendFiles);

    // For every new file coming in, either re-use the existing client file if it exists,
    // or construct a new client file
    const [newClientFiles, reusedStatus] = this.filesFromBackend(backendFiles);

    // Dispose of Client files that are not re-used (to get rid of MobX observers)
    for (const file of this.fileList) {
      if (!reusedStatus.has(file.id)) {
        file.dispose();
      }
    }

    // Check existence of new files asynchronously, no need to wait until they can be shown
    // we can simply check whether they exist after they start rendering
    // TODO: We can already get this from chokidar (folder watching), pretty much for free
    const existenceCheckPromises = newClientFiles.map((clientFile) => async () => {
      clientFile.setBroken(!(await fse.pathExists(clientFile.absolutePath)));
    });

    // Run the existence check with at most N checks in parallel
    // TODO: Should make N configurable, or determine based on the system/disk performance
    // NOTE: This is _not_ await intentionally, since we want to show the files to the user as soon as possible
    runInAction(() => {
      // TODO: restores this line later, currently broken for large lists, see https://github.com/mobxjs/mobx/pull/3189 (look ma, I'm contributing to open source!)
      // this.fileList.replace(newClientFiles);
      this.fileList.clear();
      this.fileList.push(...newClientFiles);

      this.cleanFileSelection();
      this.updateFileListState(); // update index & untagged image counter
      this.fileListLastModified = new Date();
    });
    const N = 50;
    return promiseAllLimit(existenceCheckPromises, N)
      .then(() => {
        this.updateFileListState(); // update missing image counter
      })
      .catch((e) => console.error('An error occured during existence checking!', e));
  }

  /** Remove files from selection that are not in the file list anymore */
  @action private cleanFileSelection() {
    const { fileSelection } = this.rootStore.uiStore;
    for (const file of fileSelection) {
      if (!this.index.has(file.id)) {
        fileSelection.delete(file);
      }
    }
  }

  /**
   *
   * @param backendFiles
   * @returns A list of Client files, and a set of keys that was reused from the existing fileList
   */
  @action private filesFromBackend(backendFiles: FileDTO[]): [ClientFile[], Set<ID>] {
    const reusedStatus = new Set<ID>();

    const clientFiles = backendFiles.map((f) => {
      // Might already exist!
      const existingFile = this.get(f.id);
      if (existingFile !== undefined) {
        reusedStatus.add(existingFile.id);
        // Otherwise it would write its outdated date back to the database the next time it is saved
        existingFile.dateModified = f.dateModified;
        // Update tags (might have changes, e.g. removed/merged)
        const newTags = f.tags
          .map((t) => this.rootStore.tagStore.get(t))
          .filter((t) => t !== undefined) as ClientTag[];
        if (
          existingFile.tags.size !== newTags.length ||
          Array.from(existingFile.tags).some((t, i) => t.id !== newTags[i].id)
        ) {
          existingFile.updateTagsFromBackend(newTags);
        }
        return existingFile;
      }

      // Otherwise, create new one.
      // TODO: Maybe better performance by always keeping the same pool of client files,
      // and just replacing their properties instead of creating new objects
      // But that's micro optimization...

      const file = new ClientFile(this, f);
      // Initialize the thumbnail path so the image can be loaded immediately when it mounts.
      // To ensure the thumbnail actually exists, the `ensureThumbnail` function should be called
      file.thumbnailPath = this.rootStore.imageLoader.needsThumbnail(f)
        ? getThumbnailPath(f.absolutePath, this.rootStore.uiStore.thumbnailDirectory)
        : f.absolutePath;
      return file;
    });

    return [clientFiles, reusedStatus];
  }

  /** Derive fields from `fileList`
   * - `index`
   * - `numUntaggedFiles`
   * - `numMissingFiles`
   */
  @action private updateFileListState() {
    let missingFiles = 0;
    let untaggedFiles = 0;
    this.index.clear();
    for (let index = 0; index < this.fileList.length; index++) {
      const file = this.fileList[index];
      if (file.isBroken) {
        missingFiles += 1;
      } else if (file.tags.size === 0) {
        untaggedFiles += 1;
      }
      this.index.set(file.id, index);
    }
    this.numMissingFiles = missingFiles;
    if (this.showsAllContent) {
      this.numTotalFiles = this.fileList.length;
      this.numUntaggedFiles = untaggedFiles;
    } else if (this.showsUntaggedContent) {
      this.numUntaggedFiles = this.fileList.length;
    }
  }

  /** How many images are in the given folders, and how many of those have a tag: counted in the database */
  countFilesInFolders(paths: string[]): Promise<[fileCount: number, taggedFileCount: number]> {
    return this.backend.countFilesInFolders(paths);
  }

  /** How many images have any of the given tags, or a tag inside one of them: counted in the database */
  countFilesWithAnyTag(tags: readonly ClientTag[]): Promise<number> {
    const ids = new Set<ID>();
    runInAction(() => {
      for (const tag of tags) {
        for (const subTag of tag.getSubTree()) {
          ids.add(subTag.id);
        }
      }
    });
    return this.backend.countFilesWithAnyTag(Array.from(ids));
  }

  /** Initializes the total and untagged file counters by querying the database with count operations */
  async refetchFileCounts(): Promise<void> {
    const [numTotalFiles, numUntaggedFiles] = await this.backend.countFiles();
    runInAction(() => {
      this.numUntaggedFiles = numUntaggedFiles;
      this.numTotalFiles = numTotalFiles;
    });
  }

  @action private setOrderDirection(order: OrderDirection) {
    this.orderDirection = order;
  }

  @action private setOrderBy(prop: OrderBy<FileDTO> = 'dateAdded') {
    this.orderBy = prop;
  }

  @action private setContentMissing() {
    this.content = Content.Missing;
  }

  @action private incrementNumMissingFiles() {
    this.numMissingFiles++;
  }
}

export default FileStore;

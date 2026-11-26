import { action, computed, makeObservable, observable } from 'mobx';

import {
  addGroup,
  ArrangeOptions,
  arrangeItems,
  boundsOf,
  bringToFront,
  Camera,
  pasteItems,
  changeBackground,
  changeText,
  createBackground,
  createText,
  duplicateItems,
  frontZ,
  ImageBorder,
  innerImageRect,
  LABEL_FONT_SIZE,
  LayerGroup,
  LayoutKind,
  layersFromTop,
  PAPER_FORMATS,
  moveItems,
  moveLayers,
  originalsOf,
  Point,
  Rect,
  resizeItem,
  scaleItems,
  Size,
  swapItems,
  withImageBorder,
  WorkspaceBackgroundItem,
  WorkspaceImage,
  WorkspaceImageItem,
  WorkspaceItem,
  WorkspaceLayout,
  WorkspaceRow,
  WorkspaceTextItem,
  withGroupMates,
} from 'common/workspace';
import { seededRandom, shuffled } from 'common/core';
import { croppedImage, cropOf, frameInShape, photoRectOf } from 'common/crop';
import {
  blockAt,
  CameraStop,
  DEFAULT_ARRIVAL_TIME,
  DEFAULT_BLOCK_LENGTH,
  followLayout,
  followLockedLayers,
  frameAround,
  LayoutBlock,
  MAX_SOUND_VOLUME,
  MIN_BLOCK_LENGTH,
  moveInRow,
  MusicTrack,
  newVideo,
  nextShotFrame,
  Pose,
  posesOf,
  resizeVideo,
  SoundEffect,
  startsOf,
  videoBeats,
  videoLength,
  videoSwells,
  VideoProject,
  withEnd,
  withLength,
} from 'common/video';
import { autoEdit, EditStyle } from 'common/auto-edit';
import { FileNaming } from 'common/file-naming';
import { groupOf, Motion, MotionKind, wavesAt } from 'common/video-motion';
import { wallItems, WallOptions } from 'common/wall';
import { generateId, ID } from '../../api/id';
import WorkspaceStore from '../stores/WorkspaceStore';

/** An image being cropped: see `ClientWorkspace.cropping` */
export interface CropSession {
  id: string;
  /** Where the whole photo lies on the workspace */
  photo: Rect;
  /** The part of it the image will show: where the image will be */
  frame: Rect;
  /** Width for height the frame is held to, or undefined when it is free */
  aspect: number | undefined;
}

/** How many changes can be undone */
const MAX_UNDO = 100;
/** How long before the end of the video the last wave's crest comes at the latest, in seconds */
const WAVE_ROOM = 1.5;
/** The sheet behind a title when no colour is given: near black, so the photos stand out */
const DARK_SHEET = '#0c0c0e';
/** How long a video cut to the beat is when it has no length of its own yet, in seconds */
const DEFAULT_EDIT_LENGTH = 30;

/**
 * An endless surface with images and texts arranged on it by hand, each a layer of its own. Every change
 * is stored a moment after the last one (`WorkspaceStore.saveSoon`).
 *
 * While it is locked, nothing on it is moved, sized, reordered, changed or taken off. The lock is for the
 * objects only: its video can still be edited (a layout selected then does not move anything).
 */
export class ClientWorkspace {
  private readonly store: WorkspaceStore;

  readonly id: ID;
  @observable name: string;
  /** Its place among the workspaces */
  @observable index: number;
  @observable isLocked: boolean;
  /** How the files saved from it are named, if the user chose; set when it is made */
  readonly fileNaming: FileNaming | undefined;
  /** The folder its pictures and videos are saved to, if one was chosen when it was made */
  @observable saveFolder: string | undefined;
  /** The images and texts, each a plain object that is replaced when it changes */
  readonly items = observable.array<WorkspaceItem>([], { deep: false });
  /** The ids of what is selected; not stored */
  readonly selection = observable.set<string>();
  /**
   * The groups of layers. Which layers are in one is kept on the layers (`groupId`); a group of which
   * none are left (taken off, or undone) is not shown, and not stored
   */
  readonly layerGroups = observable.array<LayerGroup>([], { deep: false });
  /**
   * An image being cropped, while it is adjusted: where its whole photo and its frame are on the workspace,
   * and the shape the frame is held to (undefined: free). Applied as one change; not stored
   */
  @observable.ref cropping: CropSession | undefined = undefined;
  /** Its video (`common/video.ts`), once one was started; replaced whole when it changes */
  @observable.ref video: VideoProject | undefined;
  /**
   * The block of the video selected on its timeline, to be changed: a camera stop follows what the frame
   * shows, a layout the workspace (`followLayout`). Not stored
   */
  @observable.ref selectedBlock: { lane: VideoLane; id: string } | undefined = undefined;
  /** Not observable: nothing renders from it, the surface moves itself */
  camera: Camera;
  /** How the selection was arranged last (`arrangeSelection`), for a shuffle; not stored */
  private lastArrangement: { kind: LayoutKind; count: number; options: ArrangeOptions } | undefined;
  /** The layout whose arrangement was put on the workspace, while it is selected (`followedLayout`) */
  private followedLayoutId: string | undefined;
  /**
   * On a locked workspace, the arrangement of the layout selected (or of the one on as the shot selected
   * begins): everything is shown there (`shownItems`) without being moved. Not stored
   */
  @observable.ref private shownPoses: Record<string, Pose> | undefined = undefined;
  /** The camera stop whose shot can be moved and sized now, while it is selected (`isEditingShot`) */
  @observable private editingShotId: string | undefined = undefined;
  /** How it was before each change, for undoing them; not stored */
  private readonly history: Snapshot[] = [];
  /** How it was before each undo, for redoing them, until the next change */
  private readonly future: Snapshot[] = [];
  /**
   * What the current session of changes is made from (Arrange's sliders, a sizing of what is selected):
   * every step starts again from it, and the whole session is one change to undo
   */
  private sessionFrom: readonly WorkspaceItem[] | undefined;
  private sessionVideoFrom: VideoProject | undefined;

  constructor(store: WorkspaceStore, row: WorkspaceRow) {
    this.store = store;
    this.id = row.id;
    this.name = row.name;
    this.index = row.index;
    this.isLocked = row.isLocked;
    this.items.replace(row.items);
    this.layerGroups.replace(row.layerGroups);
    this.camera = row.camera;
    this.video = row.video;
    this.fileNaming = row.fileNaming;
    this.saveFolder = row.saveFolder;
    makeObservable(this);
  }

  /** The ids of the files of the images on it: each once, however many copies of a photo there are */
  get fileIds(): string[] {
    // Copied once: read item by item, an observable list is checked for every item (slow in development)
    const images = this.items
      .slice()
      .filter((item): item is WorkspaceImageItem => item.kind === 'image');
    return originalsOf(images).map((image) => image.fileId);
  }

  /**
   * Everything from the top layer down, as the layers panel lists it: sorted again only when the objects
   * change, not when the selection does
   */
  @computed get layers(): WorkspaceItem[] {
    return layersFromTop(this.items.slice());
  }

  /** The one thing that is selected, if just one is */
  get selectedItem(): WorkspaceItem | undefined {
    if (this.selection.size !== 1) {
      return undefined;
    }
    const [id] = this.selection;
    return this.items.find((i) => i.id === id);
  }

  /** The one text that is selected, to be changed in the layers panel */
  get selectedText(): WorkspaceTextItem | undefined {
    const item = this.selectedItem;
    return item?.kind === 'text' ? item : undefined;
  }

  /** The one background that is selected, to be changed in the layers panel */
  get selectedBackground(): WorkspaceBackgroundItem | undefined {
    const item = this.selectedItem;
    return item?.kind === 'background' ? item : undefined;
  }

  @action.bound rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length > 0 && trimmed !== this.name) {
      this.name = trimmed;
      this.store.saveSoon(this);
    }
  }

  /** Starts cropping an image (the one selected, by default): its whole photo shows around its frame */
  @action.bound startCrop(id = this.selectedItem?.id): void {
    const item = this.items.slice().find((i) => i.id === id);
    if (this.isLocked || item?.kind !== 'image') {
      return;
    }
    this.selection.replace([item.id]);
    this.cropping = {
      id: item.id,
      photo: photoRectOf(item),
      frame: innerImageRect(item),
      aspect: undefined,
    };
  }

  /** The photo moved or zoomed under the frame, or the frame sized, while cropping */
  @action.bound adjustCrop(changes: { photo?: Rect; frame?: Rect }): void {
    const { cropping } = this;
    if (cropping !== undefined) {
      const frame = changes.frame ?? cropping.frame;
      this.cropping = {
        ...cropping,
        photo: changes.photo ?? cropping.photo,
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      };
    }
  }

  /** The frame held to a shape (`CROP_PRESETS`): 'photo' is the photo's own; undefined lets it go free */
  @action.bound setCropShape(shape: number | 'photo' | undefined): void {
    const { cropping } = this;
    if (cropping === undefined) {
      return;
    }
    const aspect = shape === 'photo' ? cropping.photo.width / cropping.photo.height : shape;
    this.cropping = {
      ...cropping,
      aspect,
      frame: frameInShape(cropping.frame, cropping.photo, aspect),
    };
  }

  /** Back to how the image showed its photo by itself: the middle, in the frame it had */
  @action.bound resetCrop(): void {
    const { cropping } = this;
    const item = this.items.slice().find((i) => i.id === cropping?.id);
    if (cropping !== undefined && item?.kind === 'image') {
      const uncropped = { ...item, crop: undefined };
      this.cropping = {
        ...cropping,
        photo: photoRectOf(uncropped),
        frame: innerImageRect(item),
      };
    }
  }

  /** The crop as it is now becomes the image's: one change to undo, none when nothing was changed */
  @action.bound applyCrop(): void {
    const { cropping } = this;
    this.cropping = undefined;
    const item = this.items.slice().find((i) => i.id === cropping?.id);
    if (cropping === undefined || this.isLocked || item?.kind !== 'image') {
      return;
    }
    if (
      sameRect(cropping.frame, innerImageRect(item)) &&
      sameRect(cropping.photo, photoRectOf(item))
    ) {
      return;
    }
    this.change(
      this.items.map((item) =>
        item.id === cropping.id && item.kind === 'image'
          ? croppedImage(item, cropping.photo, cropping.frame)
          : item,
      ),
    );
  }

  @action.bound cancelCrop(): void {
    this.cropping = undefined;
  }

  @action.bound toggleLock(): void {
    this.isLocked = !this.isLocked;
    if (this.isLocked) {
      this.selection.clear();
      this.cropping = undefined;
    } else {
      this.shownPoses = undefined;
    }
    this.store.saveSoon(this);
  }

  /** Everything as the workspace shows it: where it is, or where the video has it while locked (`shownPoses`) */
  @computed get shownItems(): WorkspaceItem[] {
    const items = this.items.slice().filter((item) => !item.isHidden);
    return this.shownPoses === undefined ? items : placedAt(items, this.shownPoses);
  }

  /**
   * Puts a batch of images at `at`, or next to what is there, with the name of where they came from above
   * them; they are selected, so Arrange can change them at once. An image is on a workspace once: the ones
   * that are already there are left where they are. Returns how many were added.
   */
  @action.bound addGroup(
    label: string,
    images: readonly WorkspaceImage[],
    layout?: WorkspaceLayout,
    at?: Point,
  ): number {
    if (this.isLocked) {
      return 0;
    }
    const present = new Set(this.fileIds);
    const newImages = images.filter((image) => !present.has(image.fileId));
    if (newImages.length === 0) {
      return 0;
    }
    this.change(
      addGroup(this.items, label, newImages, generateId(), this.store.measureText, layout, at),
    );
    this.selection.replace(newImages.map((image) => image.fileId));
    return newImages.length;
  }

  /**
   * The photos extended into a wall (`common/wall.ts`): copies of them in columns beside the block and above
   * and below it, added after everything there is (so the numbers of the photos stay as they were). One change
   * to undo. Returns how many copies were added
   */
  @action.bound extend(options: WallOptions): number {
    if (this.isLocked) {
      return 0;
    }
    const items = this.items.slice();
    const copies = wallItems(items, options, generateId, frontZ(items));
    if (copies.length > 0) {
      this.change([...items, ...copies]);
    }
    return copies.length;
  }

  /**
   * Lays out what is selected anew, from how things were before (`from`), however often a slider calls it:
   * every time from the same sizes, so nothing grows or shrinks along the way. The first call of a session
   * is the change that undo takes back; it is stored once the slider rests.
   */
  @action.bound arrangeSelection(
    kind: LayoutKind,
    count: number,
    options: ArrangeOptions,
    from: readonly WorkspaceItem[] = this.items.slice(),
  ): void {
    if (this.isLocked || this.selection.size < 2) {
      return;
    }
    this.lastArrangement = { kind, count, options: { ...options, order: undefined } };
    this.changeInSession(from, arrangeItems(from, this.selection, kind, count, options));
  }

  /**
   * What is selected laid out again as `arrangement` (as the Arrange menu shows it; else as it was
   * arranged last), its objects in another order: a variation to look at at once, one change to undo.
   * The same `seed` gives the same order again. Whether there was an arrangement to shuffle
   */
  @action.bound shuffleSelection(seed?: number, arrangement = this.lastArrangement): boolean {
    if (this.isLocked || this.selection.size < 2 || arrangement === undefined) {
      return false;
    }
    this.lastArrangement = arrangement;
    const ids = [...this.selection];
    const random = seed !== undefined ? seededRandom(seed) : Math.random;
    const order = shuffled(ids, random);
    const items = this.items.slice();
    const { kind, count, options } = arrangement;
    this.change(arrangeItems(items, this.selection, kind, count, { ...options, order }));
    return true;
  }

  /**
   * What is selected, larger or smaller by `factor` around `origin`, from how things were when this sizing
   * began (`from`): every step of a drag or of the wheel starts from the same sizes, so nothing drifts,
   * and the whole sizing is one change to undo
   */
  @action.bound scaleSelection(
    factor: number,
    origin: Point,
    from: readonly WorkspaceItem[] = this.items.slice(),
  ): void {
    if (this.isLocked || this.selection.size === 0) {
      return;
    }
    this.changeInSession(from, scaleItems(from, this.selection, factor, origin));
  }

  /** The two things that are selected trade places */
  @action.bound swapSelection(): void {
    if (this.isLocked || this.selection.size !== 2) {
      return;
    }
    const [a, b] = this.selection;
    this.change(swapItems(this.items, a, b));
  }

  /** A sheet of paper under everything, `height` high, its middle at `center`; selected */
  @action.bound addBackground(center: Point, height: number): void {
    if (this.isLocked) {
      return;
    }
    const lowest = this.items.slice().reduce((min, item) => Math.min(min, item.z), 0);
    const background = createBackground(generateId(), center, height, lowest - 1);
    this.change([...this.items, background]);
    this.selection.replace([background.id]);
  }

  @action.bound changeBackground(
    id: string,
    changes: Partial<Pick<WorkspaceBackgroundItem, 'color' | 'format'>>,
  ): void {
    if (this.isLocked) {
      return;
    }
    this.change(
      this.items.map((item) =>
        item.id === id && item.kind === 'background' ? changeBackground(item, changes) : item,
      ),
    );
  }

  /** A new text, in front of everything, selected */
  @action.bound addText(at: Point, fontSize = LABEL_FONT_SIZE): WorkspaceTextItem | undefined {
    if (this.isLocked) {
      return undefined;
    }
    const z = frontZ(this.items);
    const text = createText(generateId(), 'Text', at, z, this.store.measureText, fontSize);
    this.change([...this.items, text]);
    this.selection.replace([text.id]);
    return text;
  }

  @action.bound changeText(
    id: string,
    changes: Partial<Pick<WorkspaceTextItem, 'text' | 'color' | 'fontSize'>>,
  ): void {
    if (this.isLocked) {
      return;
    }
    this.change(
      this.items.map((item) =>
        item.id === id && item.kind === 'text'
          ? changeText(item, changes, this.store.measureText)
          : item,
      ),
    );
  }

  /** Where the subject of a photo is (`WorkspaceImageItem.subject`), or none: one change to undo */
  @action.bound setSubject(id: string, subject: Point | undefined): void {
    if (this.isLocked) {
      return;
    }
    this.change(
      this.items.map((item) =>
        item.id === id && item.kind === 'image' ? { ...item, subject } : item,
      ),
    );
  }

  /**
   * A title over the photos and as wide as they are, a line under it, and one sheet behind everything in
   * `colors.sheet`: the texts and sheets that were there make way. One change to undo; whether it was made
   */
  @action.bound addTitle(
    title: string,
    line = '',
    colors: { title?: string; sheet?: string } = {},
  ): boolean {
    const images = this.items.slice().filter((item) => item.kind === 'image');
    const photos = boundsOf(images);
    if (this.isLocked || photos === undefined) {
      return false;
    }
    const { measureText } = this.store;
    const z = frontZ(images);
    const sized = createText(generateId(), title, photos, z, measureText);
    const fontSize = (sized.fontSize * photos.width) / sized.width;
    const heading = changeText(sized, { color: colors.title, fontSize }, measureText);
    heading.y = photos.y - heading.height * 1.6;
    const under =
      line === ''
        ? []
        : [
            createText(
              generateId(),
              line,
              { x: photos.x, y: heading.y + heading.height * 1.1 },
              z + 1,
              measureText,
              heading.height * 0.14,
            ),
          ];
    const all = boundsOf([heading, ...under, photos])!;
    const sheet = changeBackground(
      createBackground(
        generateId(),
        { x: all.x + all.width / 2, y: all.y + all.height / 2 },
        Math.max(all.height, all.width / PAPER_FORMATS[0].aspect) * 1.1,
        images.reduce((min, item) => Math.min(min, item.z), 0) - 1,
      ),
      { color: colors.sheet ?? DARK_SHEET },
    );
    this.change([...images, heading, ...under, sheet]);
    this.selection.clear();
    return true;
  }

  @action.bound moveItems(ids: ReadonlySet<string>, dx: number, dy: number): void {
    if (this.isLocked || ids.size === 0 || (dx === 0 && dy === 0)) {
      return;
    }
    this.change(moveItems(this.items, ids, dx, dy));
  }

  @action.bound resizeItem(id: string, width: number): void {
    if (this.isLocked) {
      return;
    }
    this.change(this.items.map((item) => (item.id === id ? resizeItem(item, width) : item)));
  }

  /** Lifts something over what covers it; what is already on top stays as it is */
  @action.bound bringToFront(id: string): void {
    if (this.isLocked) {
      return;
    }
    const target = this.items.find((item) => item.id === id);
    const group =
      target?.groupId !== undefined
        ? this.layerGroups.find((g) => g.id === target.groupId)
        : undefined;
    if (group?.isLocked) {
      const members = new Set(
        this.items.filter((item) => item.groupId === group.id).map((item) => item.id),
      );
      const next = moveLayers(this.items, members, 0);
      const changed = next.some((item, i) => item.z !== this.items[i].z);
      if (changed) {
        this.change(next);
      }
      return;
    }
    const items = bringToFront(this.items, id);
    if (items !== this.items) {
      this.change([...items]);
    }
  }

  /** Puts these at `toIndex` of the layers from the top down (counted without them) */
  @action.bound moveLayers(ids: ReadonlySet<string>, toIndex: number): void {
    if (this.isLocked || ids.size === 0) {
      return;
    }
    this.change(moveLayers(this.items, ids, toIndex));
  }

  /** Copies of what is selected, to be pasted here or on another workspace */
  get selectedItems(): WorkspaceItem[] {
    return this.items.slice().filter((item) => this.selection.has(item.id));
  }

  /**
   * Puts copies of objects around `at`, selected; images that are on it already are left out. Returns
   * how many were pasted.
   */
  @action.bound paste(copied: readonly WorkspaceItem[], at: Point): number {
    if (this.isLocked || copied.length === 0) {
      return 0;
    }
    const { items, pasted } = pasteItems(this.items, copied, at, generateId);
    if (pasted.length > 0) {
      this.change(items);
      this.selection.replace(pasted.map((item) => item.id));
    }
    return pasted.length;
  }

  /**
   * Duplicates the objects `ids` (images, texts, backgrounds) on this workspace as new layers,
   * selected: one change to undo. Returns how many were duplicated.
   */
  @action.bound duplicateItems(ids: ReadonlySet<string>, offset?: Point): number {
    if (this.isLocked || ids.size === 0) {
      return 0;
    }
    const { items, duplicated } = duplicateItems(this.items.slice(), ids, generateId, offset);
    if (duplicated.length > 0) {
      this.change(items);
      this.selection.replace(duplicated.map((item) => item.id));
    }
    return duplicated.length;
  }

  @action.bound duplicateSelection(): number {
    return this.duplicateItems(new Set(this.selection));
  }

  /**
   * Adds, updates or removes (`undefined`) the border on every photo in `ids`: one change to undo.
   * With `from`, every step of a live slider starts from that snapshot (`changeInSession`), so nothing
   * drifts and the whole adjustment is one change to undo.
   */
  @action.bound setImageBorder(
    ids: ReadonlySet<string>,
    border: ImageBorder | undefined,
    from?: readonly WorkspaceItem[],
  ): void {
    if (this.isLocked || ids.size === 0) {
      return;
    }
    const base = from ?? this.items.slice();
    let changed = false;
    const next = base.map((item) => {
      if (item.kind !== 'image' || !ids.has(item.id)) {
        return item;
      }
      const updated = withImageBorder(item, border);
      if (
        updated.x !== item.x ||
        updated.y !== item.y ||
        updated.width !== item.width ||
        updated.height !== item.height ||
        updated.border?.mode !== item.border?.mode ||
        updated.border?.topBottom !== item.border?.topBottom ||
        updated.border?.sides !== item.border?.sides ||
        updated.border?.color !== item.border?.color
      ) {
        changed = true;
        return updated;
      }
      return item;
    });
    if (from !== undefined) {
      if (changed || from === this.sessionFrom) {
        this.changeInSession(from, next);
      }
    } else if (changed) {
      this.change(next);
    }
  }

  /** Whether an in-progress edit session started from `from` is still the active undo session */
  isInSession(from: readonly WorkspaceItem[]): boolean {
    return this.sessionFrom === from;
  }

  /**
   * Turns layers on or off (`isHidden`). With `from`, live drag-paint across multiple eye toggles in
   * the Layers panel collapses into a single undoable session.
   */
  @action.bound setItemsHidden(
    ids: ReadonlySet<string>,
    hidden: boolean,
    from?: readonly WorkspaceItem[],
  ): void {
    if (this.isLocked || ids.size === 0) {
      return;
    }
    let changed = false;
    const next = this.items.slice().map((item) => {
      if (!ids.has(item.id) || Boolean(item.isHidden) === hidden) {
        return item;
      }
      changed = true;
      if (hidden) {
        return { ...item, isHidden: true };
      }
      const visible = { ...item };
      delete visible.isHidden;
      return visible;
    });
    if (hidden) {
      ids.forEach((id) => this.selection.delete(id));
    }
    if (from !== undefined) {
      if (changed || from === this.sessionFrom) {
        this.changeInSession(from, next);
      }
    } else if (changed) {
      this.change(next);
    }
  }

  /** Takes things off the workspace. Only off the workspace: the files of images are not touched */
  @action.bound removeItems(ids: ReadonlySet<string>): void {
    if (this.isLocked || ids.size === 0) {
      return;
    }
    this.change(this.items.filter((item) => !ids.has(item.id)));
    ids.forEach((id) => this.selection.delete(id));
  }

  @action.bound removeSelected(): void {
    this.removeItems(new Set(this.selection));
  }

  /** Puts back how it was before the last change */
  @action.bound undo(): void {
    this.travel(this.history, this.future);
  }

  /** Does again what the last undo took back */
  @action.bound redo(): void {
    this.travel(this.future, this.history);
  }

  /** Selects one thing, or with `additive` adds it to (or takes it out of) what is selected */
  @action.bound select(id: string, additive: boolean): void {
    if (this.isLocked) {
      return;
    }
    // With the other layers of its group, when that is locked
    const ids = withGroupMates([id], this.items.slice(), this.layerGroups.slice());
    if (!additive) {
      this.selection.replace(ids);
    } else if (this.selection.has(id)) {
      ids.forEach((other) => this.selection.delete(other));
    } else {
      ids.forEach((other) => this.selection.add(other));
    }
  }

  @action.bound selectMany(ids: Iterable<string>, additive: boolean): void {
    if (this.isLocked) {
      return;
    }
    // In one step: a box drawn over many images calls this with every move of the pointer. Locked groups
    // come whole
    const chosen = withGroupMates(ids, this.items.slice(), this.layerGroups.slice());
    this.selection.replace(additive ? [...this.selection, ...chosen] : [...chosen]);
  }

  @action.bound selectAll(): void {
    this.selectMany(
      this.items.map((item) => item.id),
      false,
    );
  }

  @action.bound clearSelection(): void {
    this.selection.clear();
  }

  @action.bound setIndex(index: number): void {
    if (this.index !== index) {
      this.index = index;
      this.store.saveSoon(this);
    }
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.store.saveSoon(this);
  }

  toRow(): WorkspaceRow {
    return {
      id: this.id,
      name: this.name,
      index: this.index,
      items: this.items.slice(),
      camera: this.camera,
      isLocked: this.isLocked,
      layerGroups: this.groupsInUse,
      video: this.video,
      fileNaming: this.fileNaming,
      saveFolder: this.saveFolder,
    };
  }

  // The video

  /** Starts its video, the frame as large as fits in `view` (what is in view), unless it has one */
  @action.bound startVideo(view: Rect): void {
    if (this.video === undefined) {
      this.changeVideo(newVideo(view));
    }
  }

  /** The video in another size, its frames in the new shape */
  @action.bound setVideoSize(size: Size): void {
    if (this.video !== undefined) {
      this.changeVideo(resizeVideo(this.video, size), true);
    }
  }

  /** The video's frame (what it shows before it has camera stops) around everything on the workspace */
  @action.bound fitVideoFrame(): void {
    const { video } = this;
    const everything = boundsOf(this.items.slice());
    if (video !== undefined && everything !== undefined) {
      this.changeVideo(
        { ...video, frame: frameAround(everything, video.width / video.height, 0.04) },
        true,
      );
    }
  }

  @action.bound setVideoOptions(options: Partial<Pick<VideoProject, 'fps' | 'background'>>): void {
    if (this.video !== undefined) {
      this.changeVideo({ ...this.video, ...options });
    }
  }

  /**
   * A camera stop after `after` (the one selected; none: the last), selected, its shot to be placed
   * (`isEditingShot`): of `frame`, or as large as the one before and just to the right of it (`nextShotFrame`)
   */
  @action.bound addCameraStop(frame?: Rect, after = this.selectedIdIn('camera')): void {
    const { video } = this;
    if (video === undefined) {
      return;
    }
    const stop: CameraStop = {
      id: generateId(),
      frame: frame ?? nextShotFrame(video, after),
      length: DEFAULT_BLOCK_LENGTH,
      arrival: 'glide',
      arrivalTime: DEFAULT_ARRIVAL_TIME,
      stay: 'still',
      easing: 'smooth',
    };
    const camera = insertAfter(video.camera, stop, after);
    this.selectedBlock = { lane: 'camera', id: stop.id };
    this.editingShotId = stop.id;
    // The end marker on the end of the camera again, so the new stop is in the video
    this.changeVideo(withEnd({ ...video, camera }, undefined), true);
  }

  /** Whether the shot of the camera stop selected can be moved and sized on the workspace */
  @computed get isEditingShot(): boolean {
    const { selectedBlock } = this;
    return selectedBlock?.lane === 'camera' && selectedBlock.id === this.editingShotId;
  }

  /** The shot of the camera stop selected can be moved and sized, until `lockShot` */
  @action.bound editShot(): void {
    if (this.selectedBlock?.lane === 'camera') {
      this.editingShotId = this.selectedBlock.id;
    }
  }

  /** The shot being edited stays where it is from now on */
  @action.bound lockShot(): void {
    this.editingShotId = undefined;
  }

  /**
   * A whole edit put in at once (cut to the beat): its camera stops, its layouts and its motions, as one
   * change to undo; nothing is selected after it
   */
  @action.bound applyEdit(edit: Pick<VideoProject, 'camera' | 'layouts' | 'motions'>): void {
    const { video } = this;
    if (video !== undefined) {
      this.clearBlockSelection();
      this.changeVideo(withEnd({ ...video, ...edit }, video.end), true);
    }
  }

  /**
   * Its video cut to the beat (`autoEdit`): shots, layout lengths and motions made anew from where its
   * photos are in each layout (or now, without layouts), its texts as the title, and the song's beats, in
   * a style; another `seed` is another edit. As long as the video is, or 30 s when it has no length yet.
   * One change to undo
   */
  @action.bound cutToTheBeat(style: EditStyle, seed: number): void {
    const { video } = this;
    const items = this.items.slice();
    const images = items.filter((item) => item.kind === 'image');
    if (video === undefined || images.length === 0) {
      return;
    }
    const placesNow = new Map(images.map((item) => [item.id, item as Rect]));
    // A layout that places none of the photos there now is filmed as they are now
    const layouts =
      video.layouts.length > 0
        ? video.layouts.map((layout) => {
            const places = new Map(
              images
                .filter((item) => layout.poses[item.id] !== undefined)
                .map((item) => [item.id, layout.poses[item.id] as Rect]),
            );
            return places.size > 0 ? places : placesNow;
          })
        : [placesNow];
    const length = videoLength(video) > 0 ? videoLength(video) : DEFAULT_EDIT_LENGTH;
    const edit = autoEdit({
      beats: videoBeats(video),
      length,
      aspect: video.width / video.height,
      layouts,
      title: boundsOf(items.filter((item) => item.kind === 'text')),
      style,
      seed,
      newId: generateId,
    });
    // A video without a length then ends where its camera does: at the end of the edit
    this.applyEdit({
      camera: edit.camera,
      layouts: video.layouts.map((layout, i) => ({ ...layout, length: edit.layoutLengths[i] })),
      motions: edit.motions,
    });
  }

  /**
   * A shot moved or sized on the workspace: one change to undo. With `isContinuing`, a further step of
   * the same change (a value being typed, nudged again): undoing it puts the shot back where it was before
   * the first step
   */
  @action.bound setShotFrame(id: string, frame: Rect, isContinuing = false): void {
    const { video } = this;
    if (video !== undefined) {
      const camera = video.camera.map((stop) => (stop.id === id ? { ...stop, frame } : stop));
      this.changeVideo({ ...video, camera }, !isContinuing);
    }
  }

  /**
   * The shot being edited moved by `dx`, `dy` on the workspace: the arrow keys. A key held down
   * (`isContinuing` after its first step) is one change to undo
   */
  @action.bound nudgeShot(dx: number, dy: number, isContinuing = false): void {
    const stop = this.video?.camera.find((s) => s.id === this.editingShotId);
    if (stop !== undefined && this.isEditingShot) {
      const { frame } = stop;
      this.setShotFrame(stop.id, { ...frame, x: frame.x + dx, y: frame.y + dy }, isContinuing);
    }
  }

  /** The workspace as it is arranged now, as a layout after the one selected (or last), and selected */
  @action.bound addLayout(): void {
    const { video } = this;
    if (video === undefined) {
      return;
    }
    const layout: LayoutBlock = {
      id: generateId(),
      poses: posesOf(this.items.slice()),
      length: DEFAULT_BLOCK_LENGTH,
      transition: DEFAULT_ARRIVAL_TIME,
      easing: 'smooth',
    };
    const layouts = insertAfter(video.layouts, layout, this.selectedIdIn('layout'));
    this.selectedBlock = { lane: 'layout', id: layout.id };
    // Made of the workspace as it is: it shows it
    this.followedLayoutId = layout.id;
    this.changeVideo({ ...video, layouts }, true);
  }

  /** A motion of the objects `targets` from `start`, selected; entrances and exits short, others longer */
  @action.bound addMotion(kind: MotionKind, targets: string[], start: number): void {
    const { video } = this;
    if (video === undefined || targets.length === 0) {
      return;
    }
    const motion: Motion = {
      id: generateId(),
      kind,
      targets,
      start: Math.max(0, start),
      length: groupOf(kind) === 'during' ? DEFAULT_BLOCK_LENGTH : 1,
      strength: 1,
      speed: 1,
      stagger: targets.length > 1 ? 0.08 : 0,
    };
    this.selectedBlock = { lane: 'motion', id: motion.id };
    this.changeVideo({ ...video, motions: [...video.motions, motion] }, true);
  }

  /**
   * A wave (`wavesAt`) through all its photos for every swell of its song, the crest rolling across them
   * from the left as the sound swells, until the video ends; the waves there were make way. One change to
   * undo; how many waves there are
   */
  @action.bound wavesToTheMusic(strength = 1): number {
    const { video } = this;
    if (video === undefined) {
      return 0;
    }
    const middleOf = (item: WorkspaceItem) =>
      item.x + item.width / 2 + (item.y + item.height / 2) / 4;
    const photos = this.items
      .slice()
      .filter((item) => item.kind === 'image')
      .sort((a, b) => middleOf(a) - middleOf(b))
      .map((item) => item.id);
    const end = videoLength(video);
    // A crest at the very end would be cut off as it rises
    const swells = videoSwells(video).filter((swell) => end === 0 || swell < end - WAVE_ROOM);
    const waves = wavesAt(swells, photos, generateId, strength);
    this.clearBlockSelection();
    this.changeVideo(
      { ...video, motions: [...video.motions.filter((m) => m.kind !== 'wave'), ...waves] },
      true,
    );
    return waves.length;
  }

  /** The song under the video, its beats found (`findBeats`); one only */
  @action.bound setMusic(music: MusicTrack | undefined): void {
    if (this.video !== undefined) {
      this.selectedBlock = music !== undefined ? { lane: 'music', id: MUSIC_ID } : undefined;
      this.changeVideo({ ...this.video, music }, true);
    }
  }

  /**
   * Selects a block of a lane, to be changed. A camera stop: its shot, locked (the surface shows it), over
   * everything where the layout on as it begins has it, as the preview films it; a layout: everything goes
   * where it has it, and changes of the workspace then go into it. Either a change to undo.
   */
  @action.bound selectBlock(lane: VideoLane, id: string): void {
    const { video } = this;
    if (video === undefined) {
      return;
    }
    this.selectedBlock = { lane, id };
    this.editingShotId = undefined;
    if (lane === 'layout') {
      const layout = video.layouts.find((l) => l.id === id);
      if (layout !== undefined) {
        this.show(layout.poses);
        this.followedLayoutId = this.isLocked ? undefined : id;
      }
    } else if (lane === 'camera') {
      const index = video.camera.findIndex((stop) => stop.id === id);
      const layout =
        index === -1
          ? undefined
          : video.layouts[blockAt(video.layouts, startsOf(video.camera)[index])];
      if (layout !== undefined) {
        this.show(layout.poses);
      }
    }
  }

  /** Everything where `poses` has it: moved there (one change to undo), or only shown there while locked */
  private show(poses: Record<string, Pose>) {
    if (this.isLocked) {
      this.shownPoses = poses;
    } else {
      this.arrange(poses);
    }
  }

  /** No block selected: the workspace changes no stop or layout */
  @action.bound clearBlockSelection(): void {
    this.selectedBlock = undefined;
    this.editingShotId = undefined;
  }

  /** A block removed. With `isContinuing`, a further step of the change before: blocks removed together */
  @action.bound removeBlock(lane: VideoLane, id: string, isContinuing = false): void {
    const { video } = this;
    if (video === undefined) {
      return;
    }
    if (this.selectedBlock?.id === id) {
      this.selectedBlock = undefined;
    }
    this.changeVideo(
      {
        ...video,
        camera: video.camera.filter((stop) => stop.id !== id),
        layouts: video.layouts.filter((layout) => layout.id !== id),
        motions: video.motions.filter((motion) => motion.id !== id),
        sounds: video.sounds?.filter((sound) => sound.id !== id),
        music: lane === 'music' ? undefined : video.music,
      },
      !isContinuing,
    );
  }

  /**
   * A block of the camera or layout lane put at another place in its row. With `isContinuing`, a further
   * step of the change before (a block just added put in its place): no change of its own to undo
   */
  @action.bound moveBlock(
    lane: 'camera' | 'layout',
    id: string,
    toIndex: number,
    isContinuing = false,
  ): void {
    const { video } = this;
    if (video !== undefined) {
      this.changeVideo(
        lane === 'camera'
          ? { ...video, camera: moveInRow(video.camera, id, toIndex) }
          : { ...video, layouts: moveInRow(video.layouts, id, toIndex) },
        !isContinuing,
      );
    }
  }

  /** How long a block of the camera or layout lane lasts, as its edge is dragged */
  @action.bound setBlockLength(lane: 'camera' | 'layout', id: string, seconds: number): void {
    const { video } = this;
    if (video !== undefined) {
      this.changeVideo(
        lane === 'camera'
          ? { ...video, camera: withLength(video.camera, id, seconds) }
          : { ...video, layouts: withLength(video.layouts, id, seconds) },
      );
    }
  }

  /** The end marker put at a time, as it is dragged or typed; undefined puts it back on the camera's end */
  @action.bound setVideoEnd(seconds: number | undefined): void {
    const { video } = this;
    if (video !== undefined) {
      this.changeVideo(withEnd(video, seconds));
    }
  }

  /** The settings of a camera stop, changed (with sliders and menus: not each a change to undo) */
  @action.bound changeCameraStop(id: string, changes: Partial<Omit<CameraStop, 'id'>>): void {
    const { video } = this;
    if (video !== undefined) {
      const camera = video.camera.map((stop) => (stop.id === id ? { ...stop, ...changes } : stop));
      this.changeVideo({ ...video, camera });
    }
  }

  @action.bound changeLayout(
    id: string,
    changes: Partial<Pick<LayoutBlock, 'transition' | 'easing'>>,
  ): void {
    const { video } = this;
    if (video !== undefined) {
      const layouts = video.layouts.map((l) => (l.id === id ? { ...l, ...changes } : l));
      this.changeVideo({ ...video, layouts });
    }
  }

  /** A motion changed: its time when dragged, its settings, or the objects it moves */
  @action.bound changeMotion(id: string, changes: Partial<Omit<Motion, 'id'>>): void {
    const { video } = this;
    if (video !== undefined) {
      const motions = video.motions.map((m) =>
        m.id === id
          ? {
              ...m,
              ...changes,
              start: Math.max(0, changes.start ?? m.start),
              length: Math.max(MIN_BLOCK_LENGTH, changes.length ?? m.length),
            }
          : m,
      );
      this.changeVideo({ ...video, motions });
    }
  }

  /**
   * Where the song begins, how much of its start is skipped (always at least a second of it left, never
   * below 0: a song shorter than a second skips nothing), and how loud it is
   */
  @action.bound changeMusic(changes: Partial<Pick<MusicTrack, 'start' | 'trim' | 'volume'>>): void {
    const { video } = this;
    if (video?.music !== undefined) {
      const music = { ...video.music, ...changes };
      music.start = Math.max(0, music.start);
      music.trim = Math.max(0, Math.min(music.trim, music.duration - 1));
      music.volume = Math.min(1, Math.max(0, music.volume));
      this.changeVideo({ ...video, music });
    }
  }

  /** A sound effect put under the video: one change to undo */
  @action.bound addSound(sound: SoundEffect): void {
    const { video } = this;
    if (video !== undefined) {
      this.changeVideo({ ...video, sounds: [...(video.sounds ?? []), sound] }, true);
    }
  }

  /**
   * A sound effect moved to another time, or made louder or softer. No change to undo of its own: the
   * timeline's drags and the panel's settings take a `rememberVideo` before, as the music's do
   */
  @action.bound changeSound(
    id: string,
    changes: Partial<Pick<SoundEffect, 'at' | 'volume'>>,
  ): void {
    const { video } = this;
    if (video?.sounds !== undefined) {
      const sounds = video.sounds.map((sound) =>
        sound.id === id
          ? {
              ...sound,
              at: Math.max(0, changes.at ?? sound.at),
              volume: Math.min(MAX_SOUND_VOLUME, Math.max(0, changes.volume ?? sound.volume)),
            }
          : sound,
      );
      this.changeVideo({ ...video, sounds });
    }
  }

  /** A sound effect taken away. With `isContinuing`, a further step of the change before: removed together */
  @action.bound removeSound(id: string, isContinuing = false): void {
    const { video } = this;
    if (video?.sounds !== undefined) {
      const sounds = video.sounds.filter((sound) => sound.id !== id);
      this.changeVideo({ ...video, sounds }, !isContinuing);
    }
  }

  /**
   * A point to undo back to, before changes that are not each a change to undo (`changeCameraStop`,
   * `changeMotion`, `setBlockLength`...): together they are then one
   */
  @action.bound rememberVideo(): void {
    if (this.video !== undefined) {
      this.remember(this.items.slice(), 'whole');
    }
  }

  /** The id of the block selected in a lane, if one there is */
  private selectedIdIn(lane: VideoLane): string | undefined {
    return this.selectedBlock?.lane === lane ? this.selectedBlock.id : undefined;
  }

  /**
   * Everything put where `poses` has it, as one change to undo; what is not in them stays where it is.
   * With `topDown`, those objects are stacked in that order, the first on top. Nothing changes when all
   * is there already.
   */
  @action.bound arrange(poses: Record<string, Pose>, topDown: readonly string[] = []): void {
    const items = this.items.slice();
    const posed = [...topDown]
      .reverse()
      .reduce((stack, id) => moveLayers(stack, new Set([id]), 0), placedAt(items, poses));
    const isMoved = (item: WorkspaceItem, before: WorkspaceItem) =>
      !sameRect(item, before) ||
      item.z !== before.z ||
      (item.kind === 'image' && before.kind === 'image' && !sameRect(cropOf(item), cropOf(before)));
    if (!this.isLocked && posed.some((item, i) => isMoved(item, items[i]))) {
      this.change(posed);
    }
  }

  /**
   * The video changed, and it is stored. A change of the blocks or of the format can be undone (undoing
   * it puts all of the video back as it was); dragging and settings, which change with every move,
   * cannot, and leave nothing to redo
   */
  private changeVideo(video: VideoProject, isUndoable = false) {
    if (isUndoable) {
      this.remember(this.items.slice(), 'whole');
    } else {
      this.future.length = 0;
    }
    this.video = video;
    this.store.saveSoon(this);
  }

  /**
   * The layout the workspace shows, which takes over its changes (`followInLayout`): the one selected,
   * once its arrangement was put on the workspace. Not on a locked workspace (nothing moved there), and
   * not after an undo moved the objects away from it: a change then would overwrite it with another
   * arrangement
   */
  private get followedLayout(): string | undefined {
    const layout = this.selectedIdIn('layout');
    return layout !== undefined && layout === this.followedLayoutId ? layout : undefined;
  }

  /** The workspace changed: the layout it shows takes it over */
  private followInLayout() {
    const layout = this.followedLayout;
    if (this.video !== undefined && layout !== undefined) {
      this.video = followLayout(this.video, layout, this.items.slice());
    }
  }

  /** The groups that have layers in them */
  @computed get groupsInUse(): LayerGroup[] {
    const used = new Set(this.items.slice().map((item) => item.groupId));
    return this.layerGroups.slice().filter((group) => used.has(group.id));
  }

  /** The groups that something selected is in */
  get selectedGroups(): LayerGroup[] {
    const ids = new Set<string>();
    for (const item of this.items.slice()) {
      if (item.groupId !== undefined && this.selection.has(item.id)) {
        ids.add(item.groupId);
      }
    }
    return this.groupsInUse.filter((group) => ids.has(group.id));
  }

  /**
   * What is selected becomes a group of layers called `name`, locked: one change to undo. Something that
   * was in another group is in this one now. Returns the group, or undefined when fewer than two are
   * selected.
   */
  @action.bound groupSelection(name: string): LayerGroup | undefined {
    if (this.isLocked || this.selection.size < 2) {
      return undefined;
    }
    const group: LayerGroup = { id: generateId(), name: name.trim() || 'Group', isLocked: true };
    this.layerGroups.push(group);
    // Its layers together, where the top one of them was: the layers panel lists them as one block
    const ids = new Set(this.selection);
    const items = this.items.slice();
    const top = layersFromTop(items).findIndex((item) => ids.has(item.id));
    this.change(
      moveLayers(items, ids, top).map((item) =>
        ids.has(item.id) ? { ...item, groupId: group.id } : item,
      ),
    );
    return group;
  }

  /** The groups of what is selected are undone: their layers stay, each on its own */
  @action.bound ungroupSelection(): void {
    const groups = new Set(this.selectedGroups.map((group) => group.id));
    if (this.isLocked || groups.size === 0) {
      return;
    }
    this.change(
      this.items.map((item) =>
        item.groupId !== undefined && groups.has(item.groupId)
          ? { ...item, groupId: undefined }
          : item,
      ),
    );
  }

  @action.bound toggleGroupLock(groupId: string): void {
    this.updateGroup(groupId, (group) => ({ ...group, isLocked: !group.isLocked }));
  }

  @action.bound renameGroup(groupId: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      this.updateGroup(groupId, (group) => ({ ...group, name: trimmed }));
    }
  }

  /** All the layers of a group selected (or, with `additive`, added to what is selected) */
  @action.bound selectGroup(groupId: string, additive: boolean): void {
    const members = this.items.slice().filter((item) => item.groupId === groupId);
    this.selectMany(
      members.map((item) => item.id),
      additive,
    );
  }

  private updateGroup(groupId: string, update: (group: LayerGroup) => LayerGroup) {
    if (this.isLocked) {
      return;
    }
    this.layerGroups.replace(
      this.layerGroups.slice().map((group) => (group.id === groupId ? update(group) : group)),
    );
    this.store.saveSoon(this);
  }

  /** What is on it from now on: remembered for undoing, and stored */
  private change(items: WorkspaceItem[]) {
    const prevItems = this.items.slice();
    const nextVideo =
      this.video !== undefined ? followLockedLayers(this.video, prevItems, items) : undefined;
    const videoChanged = nextVideo !== undefined && nextVideo !== this.video;
    this.remember(prevItems, videoChanged ? 'whole' : undefined);
    // Another change ends a crop that was going on; applying it is a change of its own
    this.cropping = undefined;
    this.sessionFrom = undefined;
    this.sessionVideoFrom = undefined;
    this.items.replace(items);
    if (videoChanged) {
      this.video = nextVideo;
    }
    this.followInLayout();
    this.store.saveSoon(this);
  }

  /** A step of a session (`sessionFrom`): its first step is what undo takes back; stored once it rests */
  private changeInSession(from: readonly WorkspaceItem[], items: WorkspaceItem[]) {
    if (from !== this.sessionFrom) {
      this.sessionFrom = from;
      this.sessionVideoFrom = this.video;
      const baseVideo = this.sessionVideoFrom;
      const nextVideo =
        baseVideo !== undefined ? followLockedLayers(baseVideo, from, items) : undefined;
      const videoChanged = nextVideo !== undefined && nextVideo !== baseVideo;
      this.remember(from, videoChanged ? 'whole' : undefined);
    }
    this.items.replace(items);
    if (this.sessionVideoFrom !== undefined) {
      const nextVideo = followLockedLayers(this.sessionVideoFrom, from, items);
      if (nextVideo !== this.video) {
        this.video = nextVideo;
      }
    }
    this.followInLayout();
    this.store.saveSoon(this);
  }

  /**
   * A change made after an undo leaves nothing to redo. The video is remembered along only when the
   * change was to it (`videoPart` 'whole'), or to the objects while a layout was selected, which changed
   * the layouts too ('layouts'). Otherwise undo leaves the video as it is: what was changed in it since
   * without being a change to undo (a dragged edge, a setting) stays
   */
  private remember(items: readonly WorkspaceItem[], videoPart?: VideoPart) {
    const part = videoPart ?? (this.followedLayout !== undefined ? 'layouts' : undefined);
    this.history.push({
      items,
      video: part !== undefined ? { project: this.video, part } : undefined,
    });
    if (this.history.length > MAX_UNDO) {
      this.history.shift();
    }
    this.future.length = 0;
  }

  /** Back (from the history to the future) or forward again (the other way) by one change */
  private travel(from: Snapshot[], to: Snapshot[]) {
    // Locked, only what leaves the objects as they are: a change of the video made meanwhile
    const next = from[from.length - 1];
    if (next === undefined || (this.isLocked && !isSameItems(next.items, this.items.slice()))) {
      return;
    }
    const snapshot = from.pop()!;
    const { video } = snapshot;
    to.push({
      items: this.items.slice(),
      video: video !== undefined ? { project: this.video, part: video.part } : undefined,
    });
    this.cropping = undefined;
    this.sessionFrom = undefined;
    this.sessionVideoFrom = undefined;
    this.items.replace([...snapshot.items]);
    if (video !== undefined) {
      this.video = restoredVideo(this.video, video.project, video.part);
    }
    // The objects put back without their layout along (selecting another layout undone, say): the layout
    // selected is no longer what the workspace shows, and must not take over its next change
    if (video?.part !== 'layouts') {
      this.followedLayoutId = undefined;
    }
    if (this.selectedBlock !== undefined && !hasBlock(this.video, this.selectedBlock.id)) {
      this.selectedBlock = undefined;
    }
    const present = new Set(snapshot.items.map((item) => item.id));
    [...this.selection].filter((id) => !present.has(id)).forEach((id) => this.selection.delete(id));
    this.store.saveSoon(this);
  }
}

/** Whether two lists of objects are the same objects, as they were (objects are replaced when they change) */
function isSameItems(a: readonly WorkspaceItem[], b: readonly WorkspaceItem[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** What of the video a change to undo changed: all of it, or the layouts (that follow the objects) */
type VideoPart = 'whole' | 'layouts';

/** How a workspace was, for undoing a change: the video only when the change was to it */
interface Snapshot {
  items: readonly WorkspaceItem[];
  video: { project: VideoProject | undefined; part: VideoPart } | undefined;
}

/** The video as a snapshot had it: all of it, or only its layouts */
function restoredVideo(
  now: VideoProject | undefined,
  then: VideoProject | undefined,
  part: VideoPart,
): VideoProject | undefined {
  return part === 'layouts' && now !== undefined && then !== undefined
    ? { ...now, layouts: then.layouts }
    : then;
}

/** The lanes of a video's timeline */
export type VideoLane = 'camera' | 'layout' | 'motion' | 'music' | 'sound';

/** The music is one block of its lane: it has this id */
export const MUSIC_ID = 'music';

/** Whether a block is still in the video */
function hasBlock(video: VideoProject | undefined, id: string): boolean {
  return (
    video !== undefined &&
    (video.camera.some((b) => b.id === id) ||
      video.layouts.some((b) => b.id === id) ||
      video.motions.some((b) => b.id === id) ||
      (video.sounds ?? []).some((b) => b.id === id) ||
      (id === MUSIC_ID && video.music !== undefined))
  );
}

/** A block put after the one with `afterId` in its row, or last */
function insertAfter<T extends { id: string }>(
  blocks: readonly T[],
  block: T,
  afterId: string | undefined,
): T[] {
  const after = blocks.findIndex((b) => b.id === afterId);
  const at = after === -1 ? blocks.length : after + 1;
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Everything where `poses` has it; what is not in them stays where it is */
function placedAt(items: readonly WorkspaceItem[], poses: Record<string, Pose>): WorkspaceItem[] {
  return items.map((item) => {
    const pose = poses[item.id];
    if (pose === undefined) {
      return item;
    }
    const sized = item.width === pose.width ? item : resizeItem(item, pose.width);
    const moved = { ...sized, x: pose.x, y: pose.y, height: pose.height };
    // A crop of its own only where it shows another part than it does by itself
    return moved.kind === 'image' && pose.crop !== undefined && !sameRect(cropOf(moved), pose.crop)
      ? { ...moved, crop: pose.crop }
      : moved;
  });
}

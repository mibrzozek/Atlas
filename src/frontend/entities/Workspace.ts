import { action, computed, makeObservable, observable } from 'mobx';

import {
  addGroup,
  ArrangeOptions,
  arrangeItems,
  bringToFront,
  Camera,
  pasteItems,
  changeBackground,
  changeText,
  createBackground,
  createText,
  frontZ,
  LABEL_FONT_SIZE,
  LayerGroup,
  LayoutKind,
  layersFromTop,
  moveItems,
  moveLayers,
  Point,
  Rect,
  resizeItem,
  scaleItems,
  swapItems,
  WorkspaceBackgroundItem,
  WorkspaceImage,
  WorkspaceItem,
  WorkspaceLayout,
  WorkspaceRow,
  WorkspaceTextItem,
  withGroupMates,
} from 'common/workspace';
import { croppedImage, frameInShape, photoRectOf } from 'common/crop';
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

/**
 * An endless surface with images and texts arranged on it by hand, each a layer of its own. Every change
 * is stored a moment after the last one (`WorkspaceStore.saveSoon`).
 *
 * While it is locked, nothing on it is moved, sized, reordered, changed or taken off.
 */
export class ClientWorkspace {
  private readonly store: WorkspaceStore;

  readonly id: ID;
  @observable name: string;
  /** Its place among the workspaces */
  @observable index: number;
  @observable isLocked: boolean;
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
  /** Not observable: nothing renders from it, the surface moves itself */
  camera: Camera;
  /** How it was before each change, for undoing them; not stored */
  private readonly history: (readonly WorkspaceItem[])[] = [];
  /** How it was before each undo, for redoing them, until the next change */
  private readonly future: (readonly WorkspaceItem[])[] = [];
  /**
   * What the current session of changes is made from (Arrange's sliders, a sizing of what is selected):
   * every step starts again from it, and the whole session is one change to undo
   */
  private sessionFrom: readonly WorkspaceItem[] | undefined;

  constructor(store: WorkspaceStore, row: WorkspaceRow) {
    this.store = store;
    this.id = row.id;
    this.name = row.name;
    this.index = row.index;
    this.isLocked = row.isLocked;
    this.items.replace(row.items);
    this.layerGroups.replace(row.layerGroups);
    this.camera = row.camera;
    makeObservable(this);
  }

  /** The ids of the images of the library on it */
  get fileIds(): string[] {
    const ids: string[] = [];
    // Copied once: read item by item, an observable list is checked for every item (slow in development)
    for (const item of this.items.slice()) {
      if (item.kind === 'image') {
        ids.push(item.fileId);
      }
    }
    return ids;
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
    this.cropping = { id: item.id, photo: photoRectOf(item), frame: item, aspect: undefined };
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
      this.cropping = { ...cropping, photo: photoRectOf(uncropped), frame: item };
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
    const isSame = (a: Rect, b: Rect) =>
      a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    if (isSame(cropping.frame, item) && isSame(cropping.photo, photoRectOf(item))) {
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
    }
    this.store.saveSoon(this);
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
    this.changeInSession(from, arrangeItems(from, this.selection, kind, count, options));
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
    };
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
    this.remember(this.items.slice());
    // Another change ends a crop that was going on; applying it is a change of its own
    this.cropping = undefined;
    this.sessionFrom = undefined;
    this.items.replace(items);
    this.store.saveSoon(this);
  }

  /** A step of a session (`sessionFrom`): its first step is what undo takes back; stored once it rests */
  private changeInSession(from: readonly WorkspaceItem[], items: WorkspaceItem[]) {
    if (from !== this.sessionFrom) {
      this.sessionFrom = from;
      this.remember(from);
    }
    this.items.replace(items);
    this.store.saveSoon(this);
  }

  /** A change made after an undo leaves nothing to redo */
  private remember(items: readonly WorkspaceItem[]) {
    this.history.push(items);
    if (this.history.length > MAX_UNDO) {
      this.history.shift();
    }
    this.future.length = 0;
  }

  /** Back (from the history to the future) or forward again (the other way) by one change */
  private travel(from: (readonly WorkspaceItem[])[], to: (readonly WorkspaceItem[])[]) {
    const items = this.isLocked ? undefined : from.pop();
    if (items === undefined) {
      return;
    }
    to.push(this.items.slice());
    this.cropping = undefined;
    this.sessionFrom = undefined;
    this.items.replace([...items]);
    const present = new Set(items.map((item) => item.id));
    [...this.selection].filter((id) => !present.has(id)).forEach((id) => this.selection.delete(id));
    this.store.saveSoon(this);
  }
}

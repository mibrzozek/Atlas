import { action, computed, makeObservable, observable } from 'mobx';

import {
  addGroup,
  ArrangeOptions,
  arrangeItems,
  bringToFront,
  Camera,
  changeBackground,
  changeText,
  createBackground,
  createText,
  frontZ,
  LABEL_FONT_SIZE,
  LayoutKind,
  layersFromTop,
  moveItems,
  moveLayers,
  Point,
  resizeItem,
  swapItems,
  WorkspaceBackgroundItem,
  WorkspaceImage,
  WorkspaceItem,
  WorkspaceLayout,
  WorkspaceRow,
  WorkspaceTextItem,
} from 'common/workspace';
import { generateId, ID } from '../../api/id';
import WorkspaceStore from '../stores/WorkspaceStore';

/** How many changes can be undone */
const MAX_UNDO = 100;

/**
 * An endless surface with images and texts arranged on it by hand, each a layer of its own. Every change
 * is stored right away, except the camera, which changes with every frame of a pan or zoom.
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
  /** Not observable: nothing renders from it, the surface moves itself */
  camera: Camera;
  /** How it was before each change, for undoing them; not stored */
  private readonly history: (readonly WorkspaceItem[])[] = [];
  /** What the last arrangement was laid out from: one Arrange session is one change to undo */
  private arrangedFrom: readonly WorkspaceItem[] | undefined;

  constructor(store: WorkspaceStore, row: WorkspaceRow) {
    this.store = store;
    this.id = row.id;
    this.name = row.name;
    this.index = row.index;
    this.isLocked = row.isLocked;
    this.items.replace(row.items);
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
      this.store.save(this);
    }
  }

  @action.bound toggleLock(): void {
    this.isLocked = !this.isLocked;
    if (this.isLocked) {
      this.selection.clear();
    }
    this.store.save(this);
  }

  /**
   * Puts a batch of images next to what is there, with the name of where they came from above them. An
   * image is on a workspace once: the ones that are already there are left where they are.
   */
  @action.bound addGroup(
    label: string,
    images: readonly WorkspaceImage[],
    layout?: WorkspaceLayout,
  ): void {
    const present = new Set(this.fileIds);
    const newImages = images.filter((image) => !present.has(image.fileId));
    if (newImages.length === 0) {
      return;
    }
    this.change(
      addGroup(this.items, label, newImages, generateId(), this.store.measureText, layout),
    );
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
    if (from !== this.arrangedFrom) {
      this.arrangedFrom = from;
      this.remember(from);
    }
    this.items.replace(arrangeItems(from, this.selection, kind, count, options));
    this.store.saveSoon(this);
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
    const lowest = Math.min(0, ...this.items.map((item) => item.z));
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
    if (this.isLocked) {
      return;
    }
    const previous = this.history.pop();
    if (previous !== undefined) {
      this.arrangedFrom = undefined;
      this.items.replace([...previous]);
      const present = new Set(previous.map((item) => item.id));
      [...this.selection]
        .filter((id) => !present.has(id))
        .forEach((id) => this.selection.delete(id));
      this.store.save(this);
    }
  }

  /** Selects one thing, or with `additive` adds it to (or takes it out of) what is selected */
  @action.bound select(id: string, additive: boolean): void {
    if (this.isLocked) {
      return;
    }
    if (!additive) {
      this.selection.replace([id]);
    } else if (this.selection.has(id)) {
      this.selection.delete(id);
    } else {
      this.selection.add(id);
    }
  }

  @action.bound selectMany(ids: Iterable<string>, additive: boolean): void {
    if (this.isLocked) {
      return;
    }
    // In one step: a box drawn over many images calls this with every move of the pointer
    this.selection.replace(additive ? [...this.selection, ...ids] : [...ids]);
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
      this.store.save(this);
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
    };
  }

  /** What is on it from now on: remembered for undoing, and stored */
  private change(items: WorkspaceItem[]) {
    this.remember(this.items.slice());
    this.arrangedFrom = undefined;
    this.items.replace(items);
    this.store.save(this);
  }

  private remember(items: readonly WorkspaceItem[]) {
    this.history.push(items);
    if (this.history.length > MAX_UNDO) {
      this.history.shift();
    }
  }
}

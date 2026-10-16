import {
  boundsOf,
  Camera,
  cameraBetween,
  contains,
  fitCamera,
  gridLevels,
  groupUnder,
  LABEL_FONT_SIZE,
  MAX_ZOOM,
  panBy,
  PAPER_FORMATS,
  Point,
  Rect,
  resizeItem,
  Size,
  snapMove,
  SnapGuide,
  SpatialIndex,
  toWorld,
  visibleRect,
  wheelZoomFactor,
  WorkspaceImageItem,
  WorkspaceItem,
  zoomAt,
} from 'common/workspace';
import { ClientWorkspace } from '../../entities/Workspace';
import { MAX_TILES, TileImages } from './TileImages';

/**
 * The surface of a workspace on screen: the camera, the pointer, and everything that has to keep up with
 * them in every frame. Nothing here goes through React or MobX while something moves:
 *
 * - the images sit in one "world" element, moved and scaled by a single CSS transform;
 * - the grid, and images that are too small on screen to be worth an element, are drawn on one canvas
 *   behind it, in the same frame;
 * - images that are dragged or sized are moved in the page directly, and stored once when let go;
 * - React is only told (`onVisibleChange`) when the set of images that need an element changes.
 */

/**
 * Images smaller than this on screen are drawn on the canvas, from a tiny version of them: zoomed out,
 * an element for each of thousands of images would make every frame slow
 */
const MIN_ELEMENT_PIXELS = 48;
/** Smaller than this, an image is a plain dot: not worth loading even a tiny version */
const MIN_TILE_IMAGE_PIXELS = 4;
/**
 * The longest side of the overview: everything on the workspace drawn once into one picture, for when it
 * is far away. Then a frame draws that one picture instead of every image on its own (some 64 MB)
 */
const OVERVIEW_SIZE = 4096;
/** How long the images have to rest before the overview is drawn anew, in ms */
const OVERVIEW_REST = 250;
/** How far around the view images are already put in the page, in screen pixels */
const VIEW_MARGIN = 400;
/** After this long without a change, the camera has stopped */
const SETTLE_DELAY = 150;
/** One "line" of a wheel that scrolls by lines, in pixels */
const WHEEL_LINE = 40;
/** A press that moves less than this is a click, not a drag */
const CLICK_DISTANCE = 4;
/** How near, in screen pixels, an edge or middle of what is dragged comes before it snaps to another */
const SNAP_PIXELS = 7;
/** How long the camera takes to glide to an image or to everything */
const GLIDE_DURATION = 320;

export interface VisibleItems {
  /** The images that are in or near the view and large enough to be shown as an image */
  ids: ReadonlySet<string>;
}

interface SurfaceEvents {
  onVisibleChange: (visible: VisibleItems) => void;
  /** The camera came to rest */
  onSettle: (camera: Camera) => void;
  /** A text was double clicked: its words are to be changed */
  onEditText: (id: string) => void;
}

type Gesture =
  | { kind: 'pan' }
  | {
      kind: 'move';
      ids: ReadonlySet<string>;
      pressed: string;
      /** Around what is dragged, where it was, and what is near to line it up with */
      bounds: Rect;
      others: WorkspaceItem[];
      /** Their elements, found once: not searched for with every move of the pointer */
      elements: HTMLElement[];
      /** Whether it is a background alone: it lines up with the images it is under as a whole too */
      isSheet: boolean;
      /** How far it is moved, snapped, in world units */
      offset: Point;
    }
  | { kind: 'resize'; item: WorkspaceItem }
  /**
   * What was selected before, which stays selected when adding (Shift or Ctrl); and the background the
   * box was started on, which a click (no box) selects
   */
  | { kind: 'select'; before: ReadonlySet<string>; background?: string; isAdditive: boolean };

interface Press {
  pointerId: number;
  gesture: Gesture;
  start: Point;
  last: Point;
  hasMoved: boolean;
}

export class WorkspaceSurface {
  private camera: Camera;
  private view: Size = { width: 1, height: 1 };
  private readonly index = new SpatialIndex();
  private items = new Map<string, WorkspaceItem>();
  /** The same, from back to front */
  private itemsBackToFront: WorkspaceItem[] = [];
  private isGridShown = true;
  private colors = { line: '#888', tile: '#555' };

  private frame: number | undefined;
  private settleTimer: number | undefined;
  private glide: number | undefined;
  private isMoving = false;
  private visible: ReadonlySet<string> = new Set();
  /** What was in or near the view in the last frame: what can be snapped to */
  private nearby: ReadonlySet<string> = new Set();
  private press: Press | undefined;
  /** Images being dragged, and how far, in world units: the canvas draws their tiles there too */
  private dragged: { ids: ReadonlySet<string>; dx: number; dy: number } | undefined;
  private isSpaceDown = false;
  private readonly marquee: HTMLDivElement;
  /** The lines along which what is dragged lines up with something else, over everything */
  private readonly guideLayer: HTMLDivElement;
  private overview: { canvas: HTMLCanvasElement; bounds: Rect; scale: number } | undefined;
  private isOverviewStale = true;
  /** When the images last changed: the overview is drawn anew once they rest */
  private changedAt = 0;
  private overviewTimer: number | undefined;

  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly viewport: HTMLElement,
    /** Everything but the backgrounds, over the tiles */
    private readonly world: HTMLElement,
    /** The grid, under everything */
    private readonly canvas: HTMLCanvasElement,
    /** The backgrounds, over the grid and under the tiles, moved along with the world */
    private readonly backgroundWorld: HTMLElement,
    /** Images too small on screen for an element of their own, over the backgrounds */
    private readonly tileCanvas: HTMLCanvasElement,
    private readonly workspace: ClientWorkspace,
    /** The tiny versions of its images, which belong to the workspace (see WorkspaceImages) */
    private readonly tileImages: TileImages,
    private readonly events: SurfaceEvents,
  ) {
    this.camera = workspace.camera;
    tileImages.onLoad = (id) => {
      this.drawIntoOverview(id);
      this.requestFrame();
    };
    this.marquee = document.createElement('div');
    this.marquee.className = 'workspace-marquee';
    viewport.appendChild(this.marquee);
    this.guideLayer = document.createElement('div');
    this.guideLayer.className = 'workspace-guides';
    viewport.appendChild(this.guideLayer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    viewport.addEventListener('wheel', this.handleWheel, { passive: false });
    viewport.addEventListener('pointerdown', this.handlePointerDown);
    viewport.addEventListener('pointermove', this.handlePointerMove);
    viewport.addEventListener('pointerup', this.handlePointerUp);
    viewport.addEventListener('pointercancel', this.handlePointerUp);
    viewport.addEventListener('dblclick', this.handleDoubleClick);
    viewport.addEventListener('keydown', this.handleKey);
    viewport.addEventListener('keyup', this.handleKey);
    viewport.addEventListener('blur', this.handleBlur);
    this.readColors();
    this.resize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.viewport.removeEventListener('wheel', this.handleWheel);
    this.viewport.removeEventListener('pointerdown', this.handlePointerDown);
    this.viewport.removeEventListener('pointermove', this.handlePointerMove);
    this.viewport.removeEventListener('pointerup', this.handlePointerUp);
    this.viewport.removeEventListener('pointercancel', this.handlePointerUp);
    this.viewport.removeEventListener('dblclick', this.handleDoubleClick);
    this.viewport.removeEventListener('keydown', this.handleKey);
    this.viewport.removeEventListener('keyup', this.handleKey);
    this.viewport.removeEventListener('blur', this.handleBlur);
    this.marquee.remove();
    this.guideLayer.remove();
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
    }
    this.stopGlide();
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.overviewTimer);
    // Let go of the overview picture (up to 64 MB) at once
    if (this.overview !== undefined) {
      this.overview.canvas.width = 0;
    }
    this.tileImages.onLoad = undefined;
    this.tileImages.forgetUrgent();
    // What was seen last is where the workspace opens next time
    this.events.onSettle(this.camera);
  }

  /** The images that are on the workspace, whenever they change */
  setItems(items: readonly WorkspaceItem[]): void {
    const next = new Map(items.map((item) => [item.id, item]));
    for (const id of this.items.keys()) {
      if (!next.has(id)) {
        this.index.delete(id);
      }
    }
    for (const [id, item] of next) {
      if (this.items.get(id) !== item) {
        this.index.set(id, item);
      }
    }
    this.items = next;
    this.itemsBackToFront = [...items].sort((a, b) => a.z - b.z);
    this.isOverviewStale = true;
    this.changedAt = performance.now();
    this.requestFrame();
  }

  setGridShown(isShown: boolean): void {
    this.isGridShown = isShown;
    this.requestFrame();
  }

  fitEverything = (): void => {
    const bounds = boundsOf([...this.items.values()]);
    if (bounds !== undefined) {
      this.glideTo(fitCamera(bounds, this.view));
    }
  };

  /** 100%: one unit of the workspace is one pixel, around the middle of the view */
  zoomToActualSize = (): void => {
    const middle = { x: this.view.width / 2, y: this.view.height / 2 };
    this.glideTo(zoomAt(this.camera, middle, 1 / this.camera.zoom));
  };

  /** A new text in the middle of the view, its letters as large on the screen as at 100% */
  addText = (): string | undefined => {
    const middle = toWorld(this.camera, { x: this.view.width / 2, y: this.view.height / 2 });
    const fontSize = LABEL_FONT_SIZE / this.camera.zoom;
    const at = { x: middle.x - fontSize, y: middle.y - fontSize / 2 };
    return this.workspace.addText(at, fontSize)?.id;
  };

  /**
   * A sheet of paper under what is selected, a little larger than it, or else in the middle of the view,
   * most of its height
   */
  addBackground = (): void => {
    const selected = [...this.workspace.selection]
      .map((id) => this.items.get(id))
      .filter((item): item is WorkspaceItem => item !== undefined);
    const bounds = boundsOf(selected);
    if (bounds !== undefined) {
      const aspect = PAPER_FORMATS[0].aspect;
      const height = Math.max(bounds.height, bounds.width / aspect) * 1.15;
      this.workspace.addBackground(
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        height,
      );
    } else {
      const middle = toWorld(this.camera, { x: this.view.width / 2, y: this.view.height / 2 });
      this.workspace.addBackground(middle, (this.view.height * 0.8) / this.camera.zoom);
    }
    // All of it in view, its edges and the handle in its corner too: around a large selection it can
    // be larger than the view, and then could not be taken hold of
    const sheet = this.workspace.selectedBackground;
    if (sheet !== undefined) {
      this.glideTo(fitCamera(sheet, this.view, 64, this.camera.zoom));
    }
  };

  /** The camera glides to one image or text, which then fills the view, as sharp as it is */
  lookAt = (id: string): void => {
    const item = this.items.get(id);
    if (item !== undefined) {
      this.glideTo(fitCamera(item, this.view, 24, MAX_ZOOM));
    }
  };

  // Input

  private handleWheel = (event: WheelEvent) => {
    // Also stops the browser from zooming the whole window on Ctrl + wheel
    event.preventDefault();
    this.stopGlide();
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE : 1;
    const dx = event.deltaX * scale;
    const dy = event.deltaY * scale;
    if (event.ctrlKey || event.metaKey) {
      // A pinch on a touchpad comes in as Ctrl + wheel as well
      this.moveCamera(zoomAt(this.camera, this.pointerAt(event), wheelZoomFactor(dy)));
    } else if (event.shiftKey && dx === 0) {
      this.moveCamera(panBy(this.camera, -dy, 0));
    } else {
      this.moveCamera(panBy(this.camera, -dx, -dy));
    }
  };

  private handlePointerDown = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 1) || this.press !== undefined) {
      return;
    }
    event.preventDefault();
    this.viewport.focus({ preventScroll: true });
    this.stopGlide();
    const gesture = this.gestureFor(event);
    if (gesture === undefined) {
      return;
    }
    this.viewport.setPointerCapture(event.pointerId);
    const at = { x: event.clientX, y: event.clientY };
    this.press = { pointerId: event.pointerId, gesture, start: at, last: at, hasMoved: false };
    if (gesture.kind === 'pan') {
      this.viewport.dataset.panning = 'true';
    }
  };

  /**
   * What pressing here does: on something, move it (and what else is selected) or size it; on empty space,
   * draw a box that selects what it touches. The middle button, or Space held down, pans; so does any
   * drag on a locked workspace, where nothing can be selected.
   */
  private gestureFor(event: PointerEvent): Gesture | undefined {
    const workspace = this.workspace;
    const target = event.target as Element;
    const id = target.closest<HTMLElement>('.workspace-object')?.dataset.id;
    const isAdditive = event.shiftKey || event.ctrlKey || event.metaKey;

    if (event.button === 1 || this.isSpaceDown || workspace.isLocked) {
      return { kind: 'pan' };
    }
    const before = isAdditive ? new Set(workspace.selection) : new Set<string>();
    if (id === undefined) {
      return { kind: 'select', before, isAdditive };
    }
    // A background that is not selected is like empty space: a drag on it draws a box, a click selects it
    if (this.items.get(id)?.kind === 'background' && !workspace.selection.has(id)) {
      return { kind: 'select', before, background: id, isAdditive };
    }
    if (target.closest('.workspace-resize') !== null) {
      const item = this.items.get(id);
      return item !== undefined ? { kind: 'resize', item } : undefined;
    }
    if (isAdditive) {
      workspace.select(id, true);
      // Taken out of the selection: nothing to drag
      return workspace.selection.has(id) ? this.moveGesture(id) : undefined;
    }
    if (!workspace.selection.has(id)) {
      workspace.select(id, false);
    }
    // Brought to the front by the click when it is let go, or by the move: one change to undo, not two
    return this.moveGesture(id);
  }

  /** Dragging what is selected, from the one that was pressed */
  private moveGesture(pressed: string): Gesture {
    const ids = new Set(this.workspace.selection);
    const moving: WorkspaceItem[] = [];
    const others: WorkspaceItem[] = [];
    for (const id of this.nearby) {
      const item = this.items.get(id);
      if (item !== undefined && !ids.has(id)) {
        others.push(item);
      }
    }
    ids.forEach((id) => {
      const item = this.items.get(id);
      if (item !== undefined) {
        moving.push(item);
      }
    });
    const bounds = boundsOf(moving) ?? { x: 0, y: 0, width: 0, height: 0 };
    const isSheet = moving.length === 1 && moving[0].kind === 'background';
    const elements = this.elementsOf(ids);
    return {
      kind: 'move',
      ids,
      pressed,
      bounds,
      others,
      isSheet,
      elements,
      offset: { x: 0, y: 0 },
    };
  }

  private handlePointerMove = (event: PointerEvent) => {
    const press = this.press;
    if (press?.pointerId !== event.pointerId) {
      return;
    }
    const at = { x: event.clientX, y: event.clientY };
    const step = { x: at.x - press.last.x, y: at.y - press.last.y };
    press.last = at;
    if (!press.hasMoved) {
      press.hasMoved = Math.hypot(at.x - press.start.x, at.y - press.start.y) >= CLICK_DISTANCE;
      if (!press.hasMoved) {
        return;
      }
    }
    const { zoom } = this.camera;
    const total = { x: (at.x - press.start.x) / zoom, y: (at.y - press.start.y) / zoom };
    const { gesture } = press;
    switch (gesture.kind) {
      case 'pan':
        this.moveCamera(panBy(this.camera, step.x, step.y));
        break;
      case 'move': {
        // Lined up with what is near when it comes close, unless Alt is held
        const where = {
          ...gesture.bounds,
          x: gesture.bounds.x + total.x,
          y: gesture.bounds.y + total.y,
        };
        const group = gesture.isSheet ? groupUnder(where, gesture.others) : undefined;
        const snapped = event.altKey
          ? { dx: total.x, dy: total.y, guides: [] }
          : snapMove(
              gesture.bounds,
              gesture.others,
              total.x,
              total.y,
              SNAP_PIXELS / zoom,
              group !== undefined ? [group] : [],
            );
        gesture.offset = { x: snapped.dx, y: snapped.dy };
        this.dragged = { ids: gesture.ids, dx: snapped.dx, dy: snapped.dy };
        for (const element of gesture.elements) {
          element.style.transform = `translate(${snapped.dx}px, ${snapped.dy}px)`;
          // Over the others while dragged; it lies on top of them once let go
          element.style.zIndex = '1';
        }
        this.drawGuides(snapped.guides);
        this.requestFrame();
        break;
      }
      case 'resize': {
        const sized = resizeItem(gesture.item, gesture.item.width + total.x);
        for (const element of this.elementsOf(new Set([gesture.item.id]))) {
          element.style.width = `${sized.width}px`;
          element.style.height = `${sized.height}px`;
        }
        break;
      }
      case 'select':
        // What the box touches is selected while it is drawn, not only when it is let go
        this.drawMarquee(press.start, at);
        {
          const area = this.marqueeArea(press.start, at);
          const touched = this.index.query(area);
          // A background only when the box takes it in whole: it is under everything else
          touched.forEach((id) => {
            const item = this.items.get(id);
            if (item?.kind === 'background' && !contains(area, item)) {
              touched.delete(id);
            }
          });
          gesture.before.forEach((id) => touched.add(id));
          // Only when it touches something else: the layers panel draws along
          if (!sameSet(touched, this.workspace.selection)) {
            this.workspace.selectMany(touched, false);
          }
        }
        break;
    }
  };

  private handlePointerUp = (event: PointerEvent) => {
    const press = this.press;
    if (press?.pointerId !== event.pointerId) {
      return;
    }
    this.press = undefined;
    delete this.viewport.dataset.panning;
    const { gesture, hasMoved } = press;
    const { zoom } = this.camera;
    const total = {
      x: (press.last.x - press.start.x) / zoom,
      y: (press.last.y - press.start.y) / zoom,
    };

    switch (gesture.kind) {
      case 'pan':
        break;
      case 'move':
        this.dragged = undefined;
        this.drawGuides([]);
        gesture.elements.forEach((element) => element.style.removeProperty('z-index'));
        if (hasMoved) {
          // The elements keep their offset until they are drawn at their new place (WorkspaceImage)
          this.workspace.moveItems(gesture.ids, gesture.offset.x, gesture.offset.y);
        } else {
          if (!(event.shiftKey || event.ctrlKey || event.metaKey)) {
            // A click on one of several selected images selects just that one
            this.workspace.select(gesture.pressed, false);
          }
          // Also an image of which only a corner showed from under another one
          this.workspace.bringToFront(gesture.pressed);
        }
        this.requestFrame();
        break;
      case 'resize':
        if (hasMoved) {
          this.workspace.resizeItem(gesture.item.id, gesture.item.width + total.x);
        }
        break;
      case 'select':
        this.marquee.style.display = '';
        if (!hasMoved && gesture.background !== undefined) {
          this.workspace.select(gesture.background, gesture.isAdditive);
        } else if (!hasMoved && !gesture.isAdditive) {
          // A click on empty space lets go of what was selected
          this.workspace.clearSelection();
        }
        break;
    }
  };

  private handleDoubleClick = (event: MouseEvent) => {
    // Not the target of the event: while pressed, the pointer was held by the surface, which gets it
    const id = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.workspace-object')?.dataset.id;
    const item = id !== undefined ? this.items.get(id) : undefined;
    if (item?.kind === 'text' && !this.workspace.isLocked) {
      this.events.onEditText(item.id);
    } else if (item !== undefined) {
      this.lookAt(item.id);
    }
  };

  /** Space held down: dragging pans, also over images */
  private handleKey = (event: KeyboardEvent) => {
    if (event.key === ' ') {
      event.preventDefault();
      this.isSpaceDown = event.type === 'keydown';
      this.viewport.dataset.space = String(this.isSpaceDown);
    }
  };

  private handleBlur = () => {
    this.isSpaceDown = false;
    delete this.viewport.dataset.space;
  };

  /** A point of the window, in pixels from the top left of the view */
  private pointerAt(point: { clientX: number; clientY: number } | Point): Point {
    const rect = this.viewport.getBoundingClientRect();
    const x = 'clientX' in point ? point.clientX : point.x;
    const y = 'clientY' in point ? point.clientY : point.y;
    return { x: x - rect.left, y: y - rect.top };
  }

  private elementsOf(ids: ReadonlySet<string>): HTMLElement[] {
    const elements: HTMLElement[] = [];
    this.viewport.querySelectorAll<HTMLElement>('.workspace-object').forEach((element) => {
      if (ids.has(element.dataset.id ?? '')) {
        elements.push(element);
      }
    });
    return elements;
  }

  /** The lines along which things line up, on the screen */
  private drawGuides(guides: readonly SnapGuide[]) {
    const layer = this.guideLayer;
    while (layer.children.length > guides.length) {
      layer.lastElementChild!.remove();
    }
    while (layer.children.length < guides.length) {
      layer.appendChild(document.createElement('div'));
    }
    const { x, y, zoom } = this.camera;
    guides.forEach((guide, i) => {
      const line = layer.children[i] as HTMLElement;
      line.className = `workspace-guide ${guide.kind} ${guide.axis}`;
      // A line runs along the other direction than it is on; a gap along its own
      const isVertical = guide.kind === 'line' ? guide.axis === 'x' : guide.axis === 'y';
      const at = Math.round((guide.at - (isVertical ? x : y)) * zoom);
      const from = (guide.from - (isVertical ? y : x)) * zoom;
      const length = (guide.to - guide.from) * zoom;
      line.style.transform = isVertical
        ? `translate(${at}px, ${from}px)`
        : `translate(${from}px, ${at}px)`;
      line.style.width = isVertical ? '' : `${length}px`;
      line.style.height = isVertical ? `${length}px` : '';
    });
  }

  /** The part of the world inside the box drawn from one point of the window to another */
  private marqueeArea(from: Point, to: Point): Rect {
    const a = toWorld(this.camera, this.pointerAt(from));
    const b = toWorld(this.camera, this.pointerAt(to));
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  private drawMarquee(from: Point, to: Point) {
    const a = this.pointerAt(from);
    const b = this.pointerAt(to);
    const style = this.marquee.style;
    style.display = 'block';
    style.left = `${Math.min(a.x, b.x)}px`;
    style.top = `${Math.min(a.y, b.y)}px`;
    style.width = `${Math.abs(a.x - b.x)}px`;
    style.height = `${Math.abs(a.y - b.y)}px`;
  }

  // The camera

  private glideTo(target: Camera) {
    this.stopGlide();
    const from = this.camera;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / GLIDE_DURATION);
      // Fast at first, gently at the end
      const eased = 1 - Math.pow(1 - progress, 3);
      this.moveCamera(progress < 1 ? cameraBetween(from, target, eased, this.view) : target);
      this.drawNow();
      this.glide = progress < 1 ? requestAnimationFrame(step) : undefined;
    };
    this.glide = requestAnimationFrame(step);
  }

  private stopGlide() {
    if (this.glide !== undefined) {
      cancelAnimationFrame(this.glide);
      this.glide = undefined;
    }
  }

  private moveCamera(camera: Camera) {
    this.camera = camera;
    if (!this.isMoving) {
      // Moved as one picture on the graphics card while it moves; drawn sharp again once it stops
      this.isMoving = true;
      this.world.style.willChange = 'transform';
      this.backgroundWorld.style.willChange = 'transform';
    }
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(this.settle, SETTLE_DELAY);
    this.requestFrame();
  }

  private settle = () => {
    this.isMoving = false;
    this.world.style.willChange = '';
    this.backgroundWorld.style.willChange = '';
    this.readColors(); // the theme may have changed
    this.requestFrame();
    this.events.onSettle(this.camera);
  };

  private resize() {
    const { width, height } = this.viewport.getBoundingClientRect();
    this.view = { width: Math.max(1, width), height: Math.max(1, height) };
    this.requestFrame();
  }

  private readColors() {
    const style = getComputedStyle(this.viewport);
    this.colors = {
      line: style.getPropertyValue('--text-color').trim() || '#888',
      tile: style.getPropertyValue('--text-color-muted').trim() || '#555',
    };
  }

  // Drawing

  private requestFrame() {
    if (this.frame === undefined) {
      this.frame = requestAnimationFrame(this.draw);
    }
  }

  /** In this frame already, for what is itself run in a frame */
  private drawNow() {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
    }
    this.draw();
  }

  private draw = () => {
    this.frame = undefined;
    const { x, y, zoom } = this.camera;
    const transform = `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
    this.world.style.transform = transform;
    this.backgroundWorld.style.transform = transform;

    // Whether an image gets an element is decided at steps of the zoom, not in every frame: while zooming,
    // the images that change from a tile to an element and back do so a few at a time instead of always
    const steppedZoom = Math.pow(2, Math.floor(Math.log2(zoom) * 2) / 2);
    const margin = VIEW_MARGIN / zoom;
    const area = visibleRect(this.camera, this.view);
    const nearby = this.index.query({
      x: area.x - margin,
      y: area.y - margin,
      width: area.width + 2 * margin,
      height: area.height + 2 * margin,
    });
    this.nearby = nearby;
    const shown = new Set<string>();
    // Back to front, like the elements
    const tiles: WorkspaceImageItem[] = [];
    for (const item of this.itemsBackToFront) {
      if (!nearby.has(item.id)) {
        continue;
      }
      // Texts and backgrounds are few, and always sharp
      if (
        item.kind !== 'image' ||
        Math.max(item.width, item.height) * steppedZoom >= MIN_ELEMENT_PIXELS
      ) {
        shown.add(item.id);
      } else {
        tiles.push(item);
      }
    }
    this.drawCanvas(tiles);
    if (!sameSet(shown, this.visible)) {
      this.visible = shown;
      this.events.onVisibleChange({ ids: shown });
    }
  };

  /** A canvas the size of the view in device pixels, cleared */
  private prepare(canvas: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.view.width * ratio);
    const height = Math.round(this.view.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, width, height);
    return { context, ratio, width, height };
  }

  /**
   * The grid on the canvas under everything, and the images that are too small for an element of their
   * own on the canvas over the backgrounds, in device pixels
   */
  private drawCanvas(tiles: readonly WorkspaceImageItem[]) {
    const grid = this.prepare(this.canvas);
    const { zoom } = this.camera;
    if (this.isGridShown && grid.context !== null) {
      const { context, width, height } = grid;
      const { fine, fineOpacity, major } = gridLevels(zoom);
      context.strokeStyle = this.colors.line;
      context.lineWidth = 1;
      context.globalAlpha = 0.05 * fineOpacity;
      this.strokeGrid(context, fine, zoom * grid.ratio, width, height, major);
      context.globalAlpha = 0.09;
      this.strokeGrid(context, major, zoom * grid.ratio, width, height);
      context.globalAlpha = 1;
    }

    const { context, ratio, width, height } = this.prepare(this.tileCanvas);
    if (context === null) {
      return;
    }
    const { x, y } = this.camera;
    const scale = zoom * ratio;

    // What was asked for in an earlier frame and is not on screen now is not loaded first anymore
    this.tileImages.forgetUrgent();
    if (tiles.length > 0 && this.dragged === undefined && this.drawOverview(context, scale)) {
      return;
    }
    context.fillStyle = this.colors.tile;
    // More tiny images than can be kept would be loaded over and over: the rest are dots
    let tileImageBudget = MAX_TILES;
    const dragged = this.dragged;
    for (const tile of tiles) {
      const offset = dragged !== undefined && dragged.ids.has(tile.id) ? dragged : { dx: 0, dy: 0 };
      const left = (tile.x + offset.dx - x) * scale;
      const top = (tile.y + offset.dy - y) * scale;
      // At least one device pixel, so that far away images are still dots instead of nothing
      const tileWidth = Math.max(1, tile.width * scale);
      const tileHeight = Math.max(1, tile.height * scale);
      if (left > width || top > height || left + tileWidth < 0 || top + tileHeight < 0) {
        continue;
      }
      const wantsImage =
        Math.max(tileWidth, tileHeight) >= MIN_TILE_IMAGE_PIXELS * ratio && tileImageBudget-- > 0;
      const image = wantsImage ? this.tileImages.get(tile.fileId) : undefined;
      if (image !== undefined) {
        context.globalAlpha = 1;
        context.drawImage(
          image,
          ...coverSource(image, tileWidth, tileHeight),
          left,
          top,
          tileWidth,
          tileHeight,
        );
      } else {
        context.globalAlpha = 0.35;
        context.fillRect(left, top, tileWidth, tileHeight);
      }
    }
    context.globalAlpha = 1;
  }

  /**
   * Far away, everything at once from the overview, when it has at least as many pixels as the screen
   * needs. Returns whether it did; nearer by, the images are drawn one by one, which are then not many.
   */
  private drawOverview(context: CanvasRenderingContext2D, scale: number): boolean {
    if (this.isOverviewStale) {
      // Drawing every image into it takes a while: not while they keep changing (a slider of Arrange)
      const sinceChange = performance.now() - this.changedAt;
      if (sinceChange < OVERVIEW_REST) {
        window.clearTimeout(this.overviewTimer);
        this.overviewTimer = window.setTimeout(
          () => this.requestFrame(),
          OVERVIEW_REST - sinceChange,
        );
        return false;
      }
      this.buildOverview();
    }
    const overview = this.overview;
    if (overview === undefined || scale > overview.scale) {
      return false;
    }
    const { bounds } = overview;
    context.globalAlpha = 1;
    context.imageSmoothingQuality = 'medium';
    context.drawImage(
      overview.canvas,
      (bounds.x - this.camera.x) * scale,
      (bounds.y - this.camera.y) * scale,
      bounds.width * scale,
      bounds.height * scale,
    );
    return true;
  }

  /** Draws every image into the overview, from back to front: again whenever images moved */
  private buildOverview() {
    this.isOverviewStale = false;
    const bounds = boundsOf(this.itemsBackToFront);
    if (bounds === undefined) {
      this.overview = undefined;
      return;
    }
    const scale = Math.min(OVERVIEW_SIZE / bounds.width, OVERVIEW_SIZE / bounds.height);
    const canvas = this.overview?.canvas ?? document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
    canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
    this.overview = { canvas, bounds, scale };
    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }
    context.fillStyle = this.colors.tile;
    for (const item of this.itemsBackToFront) {
      if (item.kind === 'image') {
        this.drawOverviewTile(context, item);
      }
    }
  }

  /** A tiny image that just came in, into the overview as well */
  private drawIntoOverview(id: string) {
    const item = this.items.get(id);
    const context = this.overview?.canvas.getContext('2d');
    if (item?.kind === 'image' && context && !this.isOverviewStale) {
      this.drawOverviewTile(context, item);
    }
  }

  private drawOverviewTile(context: CanvasRenderingContext2D, item: WorkspaceImageItem) {
    const { bounds, scale } = this.overview!;
    const left = (item.x - bounds.x) * scale;
    const top = (item.y - bounds.y) * scale;
    const width = Math.max(1, item.width * scale);
    const height = Math.max(1, item.height * scale);
    const tile = this.tileImages.peek(item.fileId);
    if (tile !== undefined) {
      context.globalAlpha = 1;
      context.drawImage(tile, ...coverSource(tile, width, height), left, top, width, height);
    } else {
      context.globalAlpha = 0.35;
      context.fillRect(left, top, width, height);
    }
  }

  /** Lines every `spacing` world units, on whole device pixels; leaves out the ones of the level above */
  private strokeGrid(
    context: CanvasRenderingContext2D,
    spacing: number,
    scale: number,
    width: number,
    height: number,
    skipEvery?: number,
  ) {
    const { x, y } = this.camera;
    const skip = skipEvery !== undefined ? Math.round(skipEvery / spacing) : 0;
    context.beginPath();
    for (let i = Math.ceil(x / spacing); (i * spacing - x) * scale <= width; i++) {
      if (skip === 0 || i % skip !== 0) {
        const px = Math.round((i * spacing - x) * scale) + 0.5;
        context.moveTo(px, 0);
        context.lineTo(px, height);
      }
    }
    for (let j = Math.ceil(y / spacing); (j * spacing - y) * scale <= height; j++) {
      if (skip === 0 || j % skip !== 0) {
        const py = Math.round((j * spacing - y) * scale) + 0.5;
        context.moveTo(0, py);
        context.lineTo(width, py);
      }
    }
    context.stroke();
  }
}

/**
 * The part of a tile that shows in a frame of another shape: cut to it, as the image is in its element
 * (`object-fit: cover`), for images laid out in the square cells of a grid
 */
function coverSource(
  tile: ImageBitmap,
  width: number,
  height: number,
): [number, number, number, number] {
  const frame = width / height;
  if (tile.width / tile.height > frame) {
    const shown = tile.height * frame;
    return [(tile.width - shown) / 2, 0, shown, tile.height];
  }
  const shown = tile.width / frame;
  return [0, (tile.height - shown) / 2, tile.width, shown];
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
}

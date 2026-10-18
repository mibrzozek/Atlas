import { reaction } from 'mobx';

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
  MIN_DOT_SPACING,
  panBy,
  PAPER_FORMATS,
  Point,
  Rect,
  resizeItem,
  Size,
  snapMove,
  snapSize,
  SnapGuide,
  SpatialIndex,
  toScreen,
  WorkspaceGridStyle,
  toWorld,
  visibleRect,
  wheelZoomFactor,
  WorkspaceImageItem,
  WorkspaceItem,
  zoomAt,
} from 'common/workspace';
import {
  CropHandle,
  cropOf,
  dragCropHandle,
  MIN_CROP_PIXELS,
  movePhoto,
  zoomPhoto,
} from 'common/crop';
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
/** How far the wheel moves the workspace while slow scrolling is on: a tenth of the usual */
const SLOW_WHEEL_SPEED = 0.1;
/**
 * A wheel that turns this many pixels at once (or in lines) is a mouse wheel with notches, which glide; a
 * touchpad sends smaller steps. How fast a glide eases out, in ms: most of a notch is there in about 0.2 s
 */
const NOTCH_DELTA = 50;
const WHEEL_GLIDE_TIME = 70;
/** One frame at 60 per second, in ms */
const FRAME_TIME = 1000 / 60;
/** A press that moves less than this is a click, not a drag */
const CLICK_DISTANCE = 4;
/** How near, in screen pixels, an edge or middle of what is dragged comes before it snaps to another */
const SNAP_PIXELS = 7;
/**
 * Held this close to an edge of the view while drawing a box or dragging, the view scrolls that way by
 * itself, faster the closer (and beyond the edge), up to the most pixels a frame
 */
const EDGE_PIXELS = 48;
const EDGE_SPEED = 24;
/** How much a pixel of wheel with Alt sizes what is selected, and when the wheel has stopped, in ms */
const WHEEL_SCALE_RATE = 0.0012;
const WHEEL_SCALE_REST = 400;
/** Room around a photo being cropped, in pixels on the screen, for its handles */
const CROP_PADDING = 48;
/** A band at the foot of the view kept free for the tools of cropping, and how far they are from the frame */
const CROP_TOOLS_ROOM = 72;
const CROP_TOOLS_GAP = 12;
/** How long the camera takes to glide to an image or to everything */
const GLIDE_DURATION = 320;

export interface VisibleItems {
  /** The images that are in or near the view and large enough to be shown as an image */
  ids: ReadonlySet<string>;
}

/** What the surface draws in, from the bottom up */
export interface SurfaceLayers {
  /** The grid, under everything */
  grid: HTMLCanvasElement;
  /** The backgrounds, over the grid and under the tiles, moved along with the world */
  backgrounds: HTMLElement;
  /** Images too small on screen for an element of their own, over the backgrounds */
  tiles: HTMLCanvasElement;
  /** Everything but the backgrounds, over the tiles */
  world: HTMLElement;
  /** An image being cropped, over everything else (which is blurred under it), moved along with the world */
  crop: HTMLElement;
  /** The tools of cropping, in pixels of the screen, placed under the frame (`placeCropTools`) */
  cropTools: HTMLElement;
}

interface SurfaceEvents {
  onVisibleChange: (visible: VisibleItems) => void;
  /** The camera came to rest */
  onSettle: (camera: Camera) => void;
  /** A text was double clicked: its words are to be changed */
  onEditText: (id: string) => void;
  /** Ctrl and the wheel pressed: slow scrolling on or off */
  onToggleSlowScroll: () => void;
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
      /**
       * Their elements, found once: not searched for with every move of the pointer. Undefined when they
       * are to be found again, because the elements in the page changed during the drag
       */
      elements: HTMLElement[] | undefined;
      /** Whether it is a background alone: it lines up with the images it is under as a whole too */
      isSheet: boolean;
      /** How far it is moved, snapped, in world units */
      offset: Point;
    }
  /** Its width as sized so far, snapped */
  | { kind: 'resize'; item: WorkspaceItem; width: number }
  /** While cropping: an edge or corner of the frame dragged, from where the frame was when pressed */
  | { kind: 'crop-frame'; handle: CropHandle; frame: Rect }
  /** While cropping: the photo moved under the frame, from where it was when pressed */
  | { kind: 'crop-photo'; photo: Rect }
  /**
   * What is selected, sized together by the handle of its frame: from how things were when it was pressed
   * (`from`), around the top left of the frame (`bounds`), lined up with what is near (`others`)
   */
  | { kind: 'scale'; from: WorkspaceItem[]; bounds: Rect; others: WorkspaceItem[] }
  /**
   * What was selected before, which stays selected when adding (Shift or Ctrl); and the background the
   * box was started on, which a click (no box) selects
   */
  | { kind: 'select'; before: ReadonlySet<string>; background?: string; isAdditive: boolean };

interface Press {
  pointerId: number;
  gesture: Gesture;
  /** Where it was pressed, in the window, and on the workspace: what the box or the drag is held by */
  start: Point;
  startInWorld: Point;
  /** Where the pointer is now, in the window, whether Alt is held (no snapping), and Shift (a crop keeps its shape) */
  last: Point;
  isAltDown: boolean;
  isShiftDown: boolean;
  hasMoved: boolean;
}

export class WorkspaceSurface {
  private camera: Camera;
  private view: Size = { width: 1, height: 1 };
  private readonly index = new SpatialIndex();
  private items = new Map<string, WorkspaceItem>();
  /** The same, from back to front */
  private itemsBackToFront: WorkspaceItem[] = [];
  /** Undefined when the grid is hidden */
  private grid: WorkspaceGridStyle | undefined = 'lines';
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
  /** How far the wheel pans and zooms: less than 1 while slow scrolling is on */
  private wheelSpeed = 1;
  /** What the notches of the wheel still have to move the camera (`glideWheel`) */
  private wheelGlide:
    | {
        x: number;
        y: number;
        zoom: number;
        at: Point;
        frame: number | undefined;
        /** When the last frame of it was drawn */
        time: number | undefined;
      }
    | undefined;
  private readonly marquee: HTMLDivElement;
  /** The lines along which what is dragged lines up with something else, over everything */
  private readonly guideLayer: HTMLDivElement;
  private overview: { canvas: HTMLCanvasElement; bounds: Rect; scale: number } | undefined;
  private isOverviewStale = true;
  /** When the images last changed: the overview is drawn anew once they rest */
  private changedAt = 0;
  private overviewTimer: number | undefined;
  /** The frame of scrolling by itself while the pointer is held at an edge of the view */
  private edgeScroll: number | undefined;
  /** A sizing of what is selected with Alt + wheel, while the wheel keeps turning */
  private wheelScale:
    | {
        from: WorkspaceItem[];
        middle: Point;
        factor: number;
        selection: ReadonlySet<string>;
        timer: number;
      }
    | undefined;
  /** Whether the change being made is the wheel's own sizing, not one that ends its session */
  private isScalingByWheel = false;

  private readonly resizeObserver: ResizeObserver;
  private readonly stopFollowingCrop: () => void;

  constructor(
    /** The surface on screen, which also carries the colours of the theme */
    readonly viewport: HTMLElement,
    private readonly layers: SurfaceLayers,
    private readonly workspace: ClientWorkspace,
    /** The tiny versions of its images, which belong to the workspace (see WorkspaceImages) */
    private readonly tileImages: TileImages,
    private readonly events: SurfaceEvents,
  ) {
    this.camera = workspace.camera;
    // A crop that changes (its frame sized, its tools drawn) is drawn again, its tools placed under it
    this.stopFollowingCrop = reaction(
      () => workspace.cropping,
      () => this.requestFrame(),
    );
    tileImages.onLoad = (id) => {
      this.drawIntoOverview(id);
      this.requestFrame();
    };
    tileImages.onColors = () => {
      this.isOverviewStale = true;
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
    this.stopFollowingCrop();
    // A crop is not stored: left for another tab, it would come back with its image hidden and out of view
    this.workspace.cancelCrop();
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
    this.stopWheelGlide();
    this.stopEdgeScroll();
    window.clearTimeout(this.wheelScale?.timer);
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.overviewTimer);
    // Let go of the overview picture (up to 64 MB) at once
    if (this.overview !== undefined) {
      this.overview.canvas.width = 0;
    }
    this.tileImages.onLoad = undefined;
    this.tileImages.onColors = undefined;
    this.tileImages.forgetUrgent();
    // What was seen last is where the workspace opens next time
    this.events.onSettle(this.camera);
  }

  /** The images that are on the workspace, whenever they change */
  setItems(items: readonly WorkspaceItem[]): void {
    if (!this.isScalingByWheel) {
      // Changed some other way (Arrange, paste, undo): a sizing by the wheel starts again from that
      this.wheelScale = undefined;
    }
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

  /** The layers that are moved and scaled by the camera, as one */
  private get worlds(): HTMLElement[] {
    return [this.layers.backgrounds, this.layers.world, this.layers.crop];
  }

  /** While on, the wheel pans and zooms a small part as far: for placing things finely */
  setSlowScroll(isSlow: boolean): void {
    this.wheelSpeed = isSlow ? SLOW_WHEEL_SPEED : 1;
  }

  setGrid(grid: WorkspaceGridStyle | undefined): void {
    this.grid = grid;
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

  /** The middle of the view, on the workspace */
  get middle(): Point {
    return toWorld(this.camera, { x: this.view.width / 2, y: this.view.height / 2 });
  }

  /** A new text in the middle of the view, its letters as large on the screen as at 100% */
  addText = (): string | undefined => {
    const { middle } = this;
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
      this.workspace.addBackground(this.middle, (this.view.height * 0.8) / this.camera.zoom);
    }
    // All of it in view, its edges and the handle in its corner too: around a large selection it can
    // be larger than the view, and then could not be taken hold of
    const sheet = this.workspace.selectedBackground;
    if (sheet !== undefined) {
      this.glideTo(fitCamera(sheet, this.view, 64, this.camera.zoom));
    }
  };

  /**
   * Crops an image, the one selected by default: the camera glides to show all of its photo, with room
   * around it for the tools of cropping
   */
  startCrop = (id?: string): void => {
    this.workspace.startCrop(id);
    const { cropping } = this.workspace;
    if (cropping !== undefined) {
      // All of the photo, as large as fits above a band kept free for the tools
      const above = { width: this.view.width, height: this.view.height - CROP_TOOLS_ROOM };
      this.glideTo(fitCamera(cropping.photo, above, CROP_PADDING, MAX_ZOOM));
    }
  };

  /**
   * The tools of cropping under the frame, in pixels of the screen; kept inside the view when the frame
   * reaches its edge
   */
  private placeCropTools() {
    const { cropping } = this.workspace;
    const tools = this.layers.cropTools;
    if (cropping === undefined) {
      return;
    }
    const { frame } = cropping;
    const corner = toScreen(this.camera, { x: frame.x, y: frame.y + frame.height });
    const width = tools.offsetWidth;
    const height = tools.offsetHeight;
    const left = Math.min(
      Math.max(corner.x, CROP_TOOLS_GAP),
      this.view.width - width - CROP_TOOLS_GAP,
    );
    const top = Math.min(corner.y + CROP_TOOLS_GAP, this.view.height - height - CROP_TOOLS_GAP);
    tools.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /** Where on the workspace a point of the window is, such as where something was dropped */
  worldAt = (point: { clientX: number; clientY: number }): Point =>
    toWorld(this.camera, this.pointerAt(point));

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
    // Slow scrolling makes panning and zooming finer; sizing with Alt keeps its own pace
    const speed = event.altKey ? 1 : this.wheelSpeed;
    const dx = event.deltaX * scale * speed;
    const dy = event.deltaY * scale * speed;
    // A mouse wheel turns in notches: each one glides; a touchpad already sends a stream of small steps,
    // which move at once (gliding them would only make them lag)
    const isNotch =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE ||
      Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) >= NOTCH_DELTA;
    const at = this.pointerAt(event);
    if (event.ctrlKey || event.metaKey) {
      // A pinch on a touchpad comes in as Ctrl + wheel as well
      if (isNotch) {
        this.glideWheel(0, 0, Math.log(wheelZoomFactor(dy)), at);
      } else {
        this.moveCamera(zoomAt(this.camera, at, wheelZoomFactor(dy)));
      }
    } else if (event.altKey && this.workspace.cropping !== undefined) {
      // While cropping, the photo larger or smaller under the frame, around the pointer
      const { cropping } = this.workspace;
      const at = toWorld(this.camera, this.pointerAt(event));
      this.workspace.adjustCrop({
        photo: zoomPhoto(
          cropping.photo,
          cropping.frame,
          Math.exp(-(dy || dx) * WHEEL_SCALE_RATE),
          at,
        ),
      });
    } else if (event.altKey) {
      this.scaleByWheel(dy || dx);
    } else {
      const [panX, panY] = event.shiftKey && dx === 0 ? [-dy, 0] : [-dx, -dy];
      if (isNotch) {
        this.glideWheel(panX, panY, 0, at);
      } else {
        this.moveCamera(panBy(this.camera, panX, panY));
      }
    }
  };

  /**
   * A notch of the wheel glides instead of jumping: what it moves is added to what is still to go, and the
   * camera eases through it, a share in every frame, so turning on keeps one smooth movement. Pan is in
   * pixels of the screen, zoom as the logarithm of its factor, around `at` (the point under the pointer
   * stays where it is)
   */
  private glideWheel(panX: number, panY: number, zoom: number, at: Point) {
    const glide = this.wheelGlide ?? { x: 0, y: 0, zoom: 0, at, frame: undefined, time: undefined };
    glide.x += panX;
    glide.y += panY;
    glide.zoom += zoom;
    glide.at = at;
    this.wheelGlide = glide;
    if (glide.frame === undefined) {
      glide.frame = requestAnimationFrame(this.stepWheelGlide);
    }
  }

  private stepWheelGlide = (now: number) => {
    const glide = this.wheelGlide;
    if (glide === undefined) {
      return;
    }
    // The same pace at every frame rate: a share of what is left, by the time since the last frame. The
    // first frame counts as one frame (its time can lie just before the wheel turned: never backwards)
    const elapsed = glide.time === undefined ? FRAME_TIME : Math.max(0, now - glide.time);
    const share = 1 - Math.exp(-elapsed / WHEEL_GLIDE_TIME);
    glide.time = now;
    const isAlmostThere =
      Math.abs(glide.x) < 0.5 && Math.abs(glide.y) < 0.5 && Math.abs(glide.zoom) < 0.0005;
    const part = isAlmostThere ? 1 : share;
    const [x, y, zoom] = [glide.x * part, glide.y * part, glide.zoom * part];
    glide.x -= x;
    glide.y -= y;
    glide.zoom -= zoom;
    let camera = panBy(this.camera, x, y);
    if (zoom !== 0) {
      camera = zoomAt(camera, glide.at, Math.exp(zoom));
    }
    this.moveCamera(camera);
    if (isAlmostThere) {
      this.wheelGlide = undefined;
    } else {
      glide.frame = requestAnimationFrame(this.stepWheelGlide);
    }
  };

  /** Whatever moves the camera otherwise (a drag, a glide to something) takes over from the wheel */
  private stopWheelGlide() {
    if (this.wheelGlide?.frame !== undefined) {
      cancelAnimationFrame(this.wheelGlide.frame);
    }
    this.wheelGlide = undefined;
  }

  /**
   * Alt + wheel: what is selected larger (wheel up) or smaller, around its middle. The turns of one go of
   * the wheel are one sizing, from how things were when it began: one change to undo, nothing drifts
   */
  private scaleByWheel(delta: number) {
    const { workspace } = this;
    if (workspace.isLocked || workspace.selection.size === 0) {
      return;
    }
    let session = this.wheelScale;
    if (session === undefined || !sameSet(session.selection, workspace.selection)) {
      window.clearTimeout(session?.timer);
      const from = workspace.items.slice();
      const bounds = boundsOf(from.filter((item) => workspace.selection.has(item.id)));
      if (bounds === undefined) {
        return;
      }
      const middle = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      session = { from, middle, factor: 1, selection: new Set(workspace.selection), timer: 0 };
      this.wheelScale = session;
    }
    window.clearTimeout(session.timer);
    session.timer = window.setTimeout(() => (this.wheelScale = undefined), WHEEL_SCALE_REST);
    // A notch of a mouse wheel (100) is about an eighth; a touchpad's small amounts add up smoothly
    session.factor *= Math.exp(-delta * WHEEL_SCALE_RATE);
    this.isScalingByWheel = true;
    try {
      workspace.scaleSelection(session.factor, session.middle, session.from);
    } finally {
      this.isScalingByWheel = false;
    }
  }

  private handlePointerDown = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 1) || this.press !== undefined) {
      return;
    }
    event.preventDefault();
    this.stopWheelGlide();
    if (event.button === 1 && (event.ctrlKey || event.metaKey)) {
      // Ctrl and the wheel pressed: slow scrolling on or off; the wheel alone still pans
      this.events.onToggleSlowScroll();
      return;
    }
    this.viewport.focus({ preventScroll: true });
    this.stopGlide();
    const gesture = this.gestureFor(event);
    if (gesture === undefined) {
      return;
    }
    this.viewport.setPointerCapture(event.pointerId);
    const at = { x: event.clientX, y: event.clientY };
    this.press = {
      pointerId: event.pointerId,
      gesture,
      start: at,
      startInWorld: toWorld(this.camera, this.pointerAt(at)),
      last: at,
      isAltDown: event.altKey,
      isShiftDown: event.shiftKey,
      hasMoved: false,
    };
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
    // Cropping: the frame's handles size it, a drag on the photo moves it under the frame, and a press
    // anywhere else is done with it
    const { cropping } = workspace;
    if (cropping !== undefined) {
      const handle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle;
      if (handle !== undefined) {
        return { kind: 'crop-frame', handle: handle as CropHandle, frame: cropping.frame };
      }
      if (target.closest('.workspace-crop-photo, .workspace-crop-frame') !== null) {
        return { kind: 'crop-photo', photo: cropping.photo };
      }
      // Its tools are buttons of their own (seen here before React could keep the press from the surface)
      if (target.closest('.workspace-crop-tools') !== null) {
        return undefined;
      }
      workspace.applyCrop();
      return undefined;
    }
    // The handle of the frame around a selection of several: the frame is no object of its own
    if (target.closest('.workspace-group-resize') !== null) {
      return this.scaleGesture();
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
      return item !== undefined ? { kind: 'resize', item, width: item.width } : undefined;
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

  /** Sizing what is selected together, by the handle of the frame around it */
  private scaleGesture(): Gesture | undefined {
    const ids = this.workspace.selection;
    const from = this.workspace.items.slice();
    const bounds = boundsOf(from.filter((item) => ids.has(item.id)));
    return bounds === undefined
      ? undefined
      : { kind: 'scale', from, bounds, others: this.othersNear(new Set(ids)) };
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
    press.isAltDown = event.altKey;
    press.isShiftDown = event.shiftKey;
    if (!press.hasMoved) {
      press.hasMoved = Math.hypot(at.x - press.start.x, at.y - press.start.y) >= CLICK_DISTANCE;
      if (!press.hasMoved) {
        return;
      }
    }
    if (press.gesture.kind === 'pan') {
      this.moveCamera(panBy(this.camera, step.x, step.y));
    } else {
      this.follow(press);
      this.scrollAtEdge(press);
    }
  };

  /**
   * The box, the drag or the sizing brought up to where the pointer is now, measured on the workspace from
   * where it was pressed: also when the view moves under a pointer that stays where it is (the wheel, a
   * zoom, scrolling at an edge), what was pressed stays under the pointer and the box keeps its start.
   */
  private follow(press: Press) {
    const now = toWorld(this.camera, this.pointerAt(press.last));
    const total = { x: now.x - press.startInWorld.x, y: now.y - press.startInWorld.y };
    const threshold = SNAP_PIXELS / this.camera.zoom;
    const { gesture } = press;
    switch (gesture.kind) {
      case 'pan':
        break;
      case 'move': {
        // The frame around a selection of several stays where it was until it is let go: hidden meanwhile
        this.viewport.dataset.moving = 'true';
        // Lined up with what is near when it comes close, unless Alt is held
        const where = {
          ...gesture.bounds,
          x: gesture.bounds.x + total.x,
          y: gesture.bounds.y + total.y,
        };
        const group = gesture.isSheet ? groupUnder(where, gesture.others) : undefined;
        const snapped = press.isAltDown
          ? { dx: total.x, dy: total.y, guides: [] }
          : snapMove(
              gesture.bounds,
              gesture.others,
              total.x,
              total.y,
              threshold,
              group !== undefined ? [group] : [],
            );
        gesture.offset = { x: snapped.dx, y: snapped.dy };
        this.dragged = { ids: gesture.ids, dx: snapped.dx, dy: snapped.dy };
        gesture.elements ??= this.elementsOf(gesture.ids);
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
        const wanted = gesture.item.width + total.x;
        const snapped = press.isAltDown
          ? { width: wanted, guides: [] }
          : snapSize(gesture.item, this.othersNear(new Set([gesture.item.id])), wanted, threshold);
        const sized = resizeItem(gesture.item, snapped.width);
        gesture.width = sized.width;
        for (const element of this.elementsOf(new Set([gesture.item.id]))) {
          element.style.width = `${sized.width}px`;
          element.style.height = `${sized.height}px`;
        }
        this.drawGuides(snapped.guides);
        break;
      }
      case 'crop-frame': {
        const { cropping } = this.workspace;
        if (cropping !== undefined) {
          // Held to its shape when one was chosen, or while Shift is held
          const aspect =
            cropping.aspect ??
            (press.isShiftDown ? gesture.frame.width / gesture.frame.height : undefined);
          const frame = dragCropHandle(
            gesture.frame,
            cropping.photo,
            gesture.handle,
            total.x,
            total.y,
            MIN_CROP_PIXELS / this.camera.zoom,
            aspect,
          );
          this.workspace.adjustCrop({ frame });
        }
        break;
      }
      case 'crop-photo': {
        const { cropping } = this.workspace;
        if (cropping !== undefined) {
          this.workspace.adjustCrop({
            photo: movePhoto(gesture.photo, cropping.frame, total.x, total.y),
          });
        }
        break;
      }
      case 'scale': {
        // The frame's right and lower edges line up with what is near, as when sizing one object
        const { bounds } = gesture;
        const wanted = Math.max(1, bounds.width + total.x);
        const snapped = press.isAltDown
          ? { width: wanted, guides: [] }
          : snapSize(bounds, gesture.others, wanted, threshold);
        this.workspace.scaleSelection(
          snapped.width / bounds.width,
          { x: bounds.x, y: bounds.y },
          gesture.from,
        );
        this.drawGuides(snapped.guides);
        break;
      }
      case 'select': {
        // What the box touches is selected while it is drawn, not only when it is let go
        const area = {
          x: Math.min(press.startInWorld.x, now.x),
          y: Math.min(press.startInWorld.y, now.y),
          width: Math.abs(now.x - press.startInWorld.x),
          height: Math.abs(now.y - press.startInWorld.y),
        };
        this.drawMarquee(area);
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
        break;
      }
    }
  }

  /** What is near, but not these: what they can line up with */
  private othersNear(ids: ReadonlySet<string>): WorkspaceItem[] {
    const others: WorkspaceItem[] = [];
    for (const near of this.nearby) {
      const item = this.items.get(near);
      if (item !== undefined && !ids.has(near)) {
        others.push(item);
      }
    }
    return others;
  }

  /**
   * While the pointer is held near an edge of the view (or beyond it), the view scrolls that way by
   * itself, one step a frame, and the box or the drag goes along
   */
  private scrollAtEdge(press: Press) {
    const at = this.pointerAt(press.last);
    const speed = (distance: number) =>
      distance >= EDGE_PIXELS
        ? 0
        : (EDGE_SPEED * Math.min(EDGE_PIXELS, EDGE_PIXELS - distance)) / EDGE_PIXELS;
    const vx = speed(this.view.width - at.x) - speed(at.x);
    const vy = speed(this.view.height - at.y) - speed(at.y);
    if (vx === 0 && vy === 0) {
      this.stopEdgeScroll();
    } else if (this.edgeScroll === undefined) {
      const step = () => {
        if (this.press !== press) {
          this.stopEdgeScroll();
          return;
        }
        // The pointer may have moved since: how fast is worked out again every frame
        const now = this.pointerAt(press.last);
        const dx = speed(this.view.width - now.x) - speed(now.x);
        const dy = speed(this.view.height - now.y) - speed(now.y);
        if (dx === 0 && dy === 0) {
          this.stopEdgeScroll();
          return;
        }
        this.moveCamera(panBy(this.camera, -dx, -dy));
        this.edgeScroll = requestAnimationFrame(step);
      };
      this.edgeScroll = requestAnimationFrame(step);
    }
  }

  private stopEdgeScroll() {
    if (this.edgeScroll !== undefined) {
      cancelAnimationFrame(this.edgeScroll);
      this.edgeScroll = undefined;
    }
  }

  private handlePointerUp = (event: PointerEvent) => {
    const press = this.press;
    if (press?.pointerId !== event.pointerId) {
      return;
    }
    this.press = undefined;
    this.stopEdgeScroll();
    delete this.viewport.dataset.panning;
    const { gesture, hasMoved } = press;

    switch (gesture.kind) {
      case 'pan':
        break;
      case 'move':
        this.dragged = undefined;
        delete this.viewport.dataset.moving;
        this.drawGuides([]);
        gesture.elements?.forEach((element) => element.style.removeProperty('z-index'));
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
      case 'scale':
        this.drawGuides([]);
        break;
      case 'resize':
        this.drawGuides([]);
        if (hasMoved) {
          this.workspace.resizeItem(gesture.item.id, gesture.width);
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
      // Held to pan: not a shortcut of the window as well
      event.stopPropagation();
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

  /** The box that selects, drawn over everything where the area of the workspace is on screen */
  private drawMarquee(area: Rect) {
    const a = toScreen(this.camera, area);
    const b = toScreen(this.camera, { x: area.x + area.width, y: area.y + area.height });
    const style = this.marquee.style;
    style.display = 'block';
    style.left = `${a.x}px`;
    style.top = `${a.y}px`;
    style.width = `${b.x - a.x}px`;
    style.height = `${b.y - a.y}px`;
  }

  // The camera

  private glideTo(target: Camera) {
    this.stopGlide();
    this.stopWheelGlide();
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
    // What is being drawn or dragged stays held where it was pressed on the workspace
    if (this.press?.hasMoved === true && this.press.gesture.kind !== 'pan') {
      this.follow(this.press);
    }
    if (!this.isMoving) {
      // Moved as one picture on the graphics card while it moves; drawn sharp again once it stops
      this.isMoving = true;
      this.worlds.forEach((world) => (world.style.willChange = 'transform'));
    }
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(this.settle, SETTLE_DELAY);
    this.requestFrame();
  }

  private settle = () => {
    this.isMoving = false;
    this.worlds.forEach((world) => (world.style.willChange = ''));
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
    this.worlds.forEach((world) => (world.style.transform = transform));
    // What has to be as large on the screen at every zoom (the handles of a crop) is sized by this
    this.layers.crop.style.setProperty('--zoom', String(zoom));
    this.placeCropTools();

    // Whether an image gets an element is decided at steps of the zoom, not in every frame: while zooming,
    // the images that change from a tile to an element and back do so a few at a time instead of always
    const steppedZoom = Math.pow(2, Math.floor(Math.log2(zoom) * 2) / 2);
    const margin = VIEW_MARGIN / zoom;
    const area = visibleRect(this.camera, this.view);
    const near = {
      x: area.x - margin,
      y: area.y - margin,
      width: area.width + 2 * margin,
      height: area.height + 2 * margin,
    };
    const nearby = this.index.query(near);
    const { dragged } = this;
    if (dragged !== undefined) {
      // What is dragged is drawn away from where it is stored: also near when its new place is
      const movedNear = { ...near, x: near.x - dragged.dx, y: near.y - dragged.dy };
      this.index.query(movedNear).forEach((id) => dragged.ids.has(id) && nearby.add(id));
    }
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
      const press = this.press;
      if (press?.gesture.kind === 'move' && press.hasMoved) {
        // Elements that came for dragged images while it is dragged (the view scrolled, or zoomed in)
        // are moved along as soon as they are in the page
        press.gesture.elements = undefined;
        window.setTimeout(() => this.press === press && this.follow(press));
      }
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
    const grid = this.prepare(this.layers.grid);
    const { zoom } = this.camera;
    if (this.grid === 'lines' && grid.context !== null) {
      const { context, width, height } = grid;
      const { fine, fineOpacity, major } = gridLevels(zoom);
      context.strokeStyle = this.colors.line;
      context.lineWidth = 1;
      context.globalAlpha = 0.05 * fineOpacity;
      this.strokeGrid(context, fine, zoom * grid.ratio, width, height, major);
      context.globalAlpha = 0.09;
      this.strokeGrid(context, major, zoom * grid.ratio, width, height);
      context.globalAlpha = 1;
    } else if (this.grid === 'dots' && grid.context !== null) {
      const { context, ratio, width, height } = grid;
      const { fine, fineOpacity, major } = gridLevels(zoom, MIN_DOT_SPACING);
      context.fillStyle = this.colors.line;
      // A dot stands for where two lines would cross, so it can be much stronger than a line; the fine
      // ones grow in as they spread apart, so a zoom never makes them pop
      context.globalAlpha = 0.38 * Math.sqrt(fineOpacity);
      this.dotGrid(
        context,
        fine,
        zoom * ratio,
        width,
        height,
        (0.7 + 0.4 * fineOpacity) * ratio,
        major,
      );
      context.globalAlpha = 0.45;
      this.dotGrid(context, major, zoom * ratio, width, height, 1.5 * ratio);
      context.globalAlpha = 1;
    }

    const { context, ratio, width, height } = this.prepare(this.layers.tiles);
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
        context.drawImage(image, ...cropSource(image, tile), left, top, tileWidth, tileHeight);
      } else {
        this.fillWithColor(context, tile.fileId, left, top, tileWidth, tileHeight);
      }
    }
    context.globalAlpha = 1;
  }

  /** An image without its tiny version yet: its average colour when that is known, else a faint dot */
  private fillWithColor(
    context: CanvasRenderingContext2D,
    fileId: string,
    left: number,
    top: number,
    width: number,
    height: number,
  ) {
    const color = this.tileImages.colorOf(fileId);
    context.globalAlpha = color !== undefined ? 1 : 0.35;
    context.fillStyle = color ?? this.colors.tile;
    context.fillRect(left, top, width, height);
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
      context.drawImage(tile, ...cropSource(tile, item), left, top, width, height);
    } else {
      this.fillWithColor(context, item.fileId, left, top, width, height);
    }
  }

  /**
   * Dots `radius` device pixels large every `spacing` world units, in one path; leaves out the ones of the
   * level above, which are drawn larger
   */
  private dotGrid(
    context: CanvasRenderingContext2D,
    spacing: number,
    scale: number,
    width: number,
    height: number,
    radius: number,
    skipEvery?: number,
  ) {
    const { x, y } = this.camera;
    const skip = skipEvery !== undefined ? Math.round(skipEvery / spacing) : 0;
    context.beginPath();
    for (let i = Math.ceil(x / spacing); (i * spacing - x) * scale <= width; i++) {
      const px = (i * spacing - x) * scale;
      for (let j = Math.ceil(y / spacing); (j * spacing - y) * scale <= height; j++) {
        if (skip === 0 || i % skip !== 0 || j % skip !== 0) {
          const py = (j * spacing - y) * scale;
          context.moveTo(px + radius, py);
          context.arc(px, py, radius, 0, Math.PI * 2);
        }
      }
    }
    context.fill();
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

/** The part of a tile that an image shows: its crop, as the element shows it (`cropOf`) */
function cropSource(tile: ImageBitmap, item: WorkspaceImageItem): [number, number, number, number] {
  const crop = cropOf(item);
  return [
    crop.x * tile.width,
    crop.y * tile.height,
    crop.width * tile.width,
    crop.height * tile.height,
  ];
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

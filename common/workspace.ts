/**
 * Workspaces: endless surfaces on which images and texts are arranged by hand. This is the maths of them:
 * the camera that looks at the surface, where new images go, which objects are in view, the order from
 * back to front (the layers), and the grid behind it all. Positions and sizes are in "world" units: one
 * unit is one pixel at 100%.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** Where the camera looks: the world point at the top left of the view, and how much it is enlarged */
export interface Camera extends Point {
  zoom: number;
}

/**
 * Something on a workspace: an image, a text, or a background. A higher `z` is in front of (a layer above)
 * a lower one; backgrounds are drawn under everything else, whatever their layer.
 */
export type WorkspaceItem = WorkspaceImageItem | WorkspaceTextItem | WorkspaceBackgroundItem;

interface WorkspaceObject extends Rect {
  id: string;
  z: number;
}

/** An image of the library. Its id is the id of the file: an image is on a workspace once */
export interface WorkspaceImageItem extends WorkspaceObject {
  kind: 'image';
  fileId: string;
  /** Width for height of the photo itself: its frame can be cut to another shape (a crop) */
  imageAspect: number;
}

/** A text, such as the name of what a batch of images came from. Its size follows from its letters */
export interface WorkspaceTextItem extends WorkspaceObject {
  kind: 'text';
  text: string;
  /** Any CSS colour, also a colour of the theme such as `var(--accent-color)`; empty is the usual */
  color: string;
  fontSize: number;
}

/** A sheet under images: of a colour and the shape of a paper format, such as A4 */
export interface WorkspaceBackgroundItem extends WorkspaceObject {
  kind: 'background';
  /** Any CSS colour, also a colour of the theme */
  color: string;
  /** The name of one of the `PAPER_FORMATS` */
  format: string;
}

/** An image to be put on a workspace, with the shape it is shown in */
export interface WorkspaceImage extends Size {
  fileId: string;
}

/** How a workspace is stored: one row of the `Atlas_Workspaces` database */
export interface WorkspaceRow {
  id: string;
  name: string;
  /** Its place among the workspaces */
  index: number;
  items: WorkspaceItem[];
  camera: Camera;
  isLocked: boolean;
}

// The camera

/** Out to an image of 2,000 pixels being one pixel, in to 32 times: endless, in practice */
export const MIN_ZOOM = 1 / 2000;
export const MAX_ZOOM = 32;

export const START_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** How much one pixel of wheel turns the zoom: a notch of a mouse wheel (100) is about a fifth */
const ZOOM_PER_WHEEL_PIXEL = 0.002;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

export function toWorld(camera: Camera, point: Point): Point {
  return { x: point.x / camera.zoom + camera.x, y: point.y / camera.zoom + camera.y };
}

/** The camera moved along with a drag of the surface over this many screen pixels */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom, zoom: camera.zoom };
}

/** Zooms by `factor`, keeping the world point under `screenPoint` (the pointer) where it is */
export function zoomAt(camera: Camera, screenPoint: Point, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const anchor = toWorld(camera, screenPoint);
  return { x: anchor.x - screenPoint.x / zoom, y: anchor.y - screenPoint.y / zoom, zoom };
}

/**
 * The zoom factor for a turn of the wheel or a pinch of a touchpad (which Chromium reports as Ctrl + wheel).
 * Exponential, so that zooming in and out by the same amount ends where it began, and small touchpad
 * amounts zoom smoothly instead of in steps.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * ZOOM_PER_WHEEL_PIXEL);
}

/** The part of the world that is in view */
export function visibleRect(camera: Camera, view: Size): Rect {
  return {
    x: camera.x,
    y: camera.y,
    width: view.width / camera.zoom,
    height: view.height / camera.zoom,
  };
}

export function boundsOf(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) {
    return undefined;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The camera that shows all of `bounds` in the middle of the view. Not enlarged beyond `maxZoom`: 100%
 * for everything on a workspace, more for one image that is looked at closely.
 */
export function fitCamera(bounds: Rect, view: Size, padding = 48, maxZoom = 1): Camera {
  const zoom = clampZoom(
    Math.min(
      maxZoom,
      (view.width - 2 * padding) / Math.max(1, bounds.width),
      (view.height - 2 * padding) / Math.max(1, bounds.height),
    ),
  );
  return {
    x: bounds.x + bounds.width / 2 - view.width / zoom / 2,
    y: bounds.y + bounds.height / 2 - view.height / zoom / 2,
    zoom,
  };
}

/**
 * A camera `progress` (0 to 1) of the way from one to another. The middle of the view travels in a straight
 * line, and the zoom changes at an even pace to the eye (by its logarithm), as in a map.
 */
export function cameraBetween(from: Camera, to: Camera, progress: number, view: Size): Camera {
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * progress);
  const middleOf = (camera: Camera) => ({
    x: camera.x + view.width / camera.zoom / 2,
    y: camera.y + view.height / camera.zoom / 2,
  });
  const a = middleOf(from);
  const b = middleOf(to);
  const middle = { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
  return { x: middle.x - view.width / zoom / 2, y: middle.y - view.height / zoom / 2, zoom };
}

// Placing images

/** The height of the rows a new batch of images is laid out in, like a gallery at its default size */
export const GROUP_ROW_HEIGHT = 240;
/** The space between images laid out together, as in the Library */
export const LAYOUT_GAP = 8;
/** The size of the letters of a new text */
export const LABEL_FONT_SIZE = 28;
/** The size of the letters of the name of a batch, written large above it */
export const GROUP_NAME_FONT_SIZE = 64;
/** Room above a batch for its name */
export const GROUP_LABEL_SPACE = Math.ceil(GROUP_NAME_FONT_SIZE * 1.25) + 16;
/** Between one batch and the next */
export const GROUP_SPACING = 160;

/** Where the next batch goes: to the right of everything that is there, at the top of it */
export function nextGroupOrigin(items: readonly Rect[]): Point {
  const bounds = boundsOf(items);
  return bounds === undefined
    ? { x: 0, y: 0 }
    : { x: bounds.x + bounds.width + GROUP_SPACING, y: bounds.y };
}

/**
 * How a batch is laid out when it has no layout of its own: justified rows in a block about as wide as a
 * monitor is for its height
 */
export function defaultLayout(shapes: readonly Size[]): WorkspaceLayout {
  const area = shapes.reduce(
    (sum, shape) =>
      sum + (GROUP_ROW_HEIGHT * aspectOf(shape) + LAYOUT_GAP) * (GROUP_ROW_HEIGHT + LAYOUT_GAP),
    0,
  );
  const widest = Math.max(0, ...shapes.map((shape) => GROUP_ROW_HEIGHT * aspectOf(shape)));
  return {
    kind: 'rows',
    width: Math.max(Math.sqrt((area * 16) / 9), widest),
    rowHeight: GROUP_ROW_HEIGHT,
  };
}

/**
 * Lays out a batch of images from `origin` down (below room for its name), in the order given.
 * `z` counts up from `firstZ`.
 */
export function placeGroup(
  images: readonly WorkspaceImage[],
  origin: Point,
  firstZ: number,
  layout: WorkspaceLayout = defaultLayout(images),
): WorkspaceImageItem[] {
  const rects = layOut(images, { x: origin.x, y: origin.y + GROUP_LABEL_SPACE }, layout);
  return images.map((image, i) => ({
    kind: 'image',
    id: image.fileId,
    fileId: image.fileId,
    imageAspect: aspectOf(image),
    ...rects[i],
    z: firstZ + i,
  }));
}

/**
 * A batch of images added next to what is there, in front of everything, with a text above them: the
 * name of where they came from, an object of its own that can be moved, changed or taken off.
 */
export function addGroup(
  items: readonly WorkspaceItem[],
  label: string,
  images: readonly WorkspaceImage[],
  textId: string,
  measure: MeasureText,
  layout?: WorkspaceLayout,
): WorkspaceItem[] {
  const origin = nextGroupOrigin(items);
  const placed = placeGroup(images, origin, frontZ(items), layout);
  const z = frontZ([...items, ...placed]);
  const name = createText(textId, label, origin, z, measure, GROUP_NAME_FONT_SIZE);
  return [...items, ...placed, name];
}

// Layouts: the same as the views of the Library

/** The shapes images in a grid can be cut to: square, or 4 wide for 5 high (a portrait print) */
export type CropShape = '1:1' | '4:5';

export const CROP_ASPECTS: Record<CropShape, number> = { '1:1': 1, '4:5': 4 / 5 };

export type WorkspaceLayout = (
  | /** Rows of the same height that fill `width`, like the horizontal masonry view */
  { kind: 'rows'; width: number; rowHeight: number }
  /** Columns of the same width, each image going in the shortest, like the vertical masonry view */
  | { kind: 'columns'; columns: number; columnWidth: number }
  /**
   * Cells `cell` wide, like the grid view: each image cut to the shape of its cell (`crop`, as the grid
   * shows square thumbnails), or whole in the middle of a square cell
   */
  | { kind: 'grid'; columns: number; cell: number; crop?: CropShape }
) & {
  /** The space between images; the Library's when not given */
  gap?: number;
};

export type LayoutKind = WorkspaceLayout['kind'];

/** Width for height; a shape that is not known is taken to be square */
function aspectOf({ width, height }: Size): number {
  return width > 0 && height > 0 ? width / height : 1;
}

/** Where shapes go in a layout, in the order given, from `origin` */
export function layOut(shapes: readonly Size[], origin: Point, layout: WorkspaceLayout): Rect[] {
  const rects: Rect[] = [];
  const gap = layout.gap ?? LAYOUT_GAP;
  if (layout.kind === 'rows') {
    // As the gallery does it (wasm/masonry/src/layout.rs), in whole pixels: images are added to a row at
    // the height of the row until, with the space after each, it is wider than the width; then the row
    // is scaled to the width, the space after the last included. A last row that is not full stays as it is
    let top = 0;
    let row: Rect[] = [];
    let rowWidth = 0;
    for (const shape of shapes) {
      const width = Math.floor(layout.rowHeight * aspectOf(shape));
      const rect = { x: rowWidth, y: top, width, height: layout.rowHeight };
      rects.push(rect);
      row.push(rect);
      rowWidth += width + gap;
      if (rowWidth > layout.width) {
        const factor = layout.width / rowWidth;
        for (const r of row) {
          r.x = Math.floor(r.x * factor);
          r.width = Math.floor(r.width * factor);
          r.height = Math.floor(r.height * factor);
        }
        top += row[0].height + gap;
        row = [];
        rowWidth = 0;
      }
    }
    rects.forEach((rect) => {
      rect.x += origin.x;
      rect.y += origin.y;
    });
  } else if (layout.kind === 'columns') {
    const heights = new Array<number>(Math.max(1, layout.columns)).fill(0);
    for (const shape of shapes) {
      const column = heights.indexOf(Math.min(...heights));
      const height = Math.floor(layout.columnWidth / aspectOf(shape));
      rects.push({
        x: origin.x + column * (layout.columnWidth + gap),
        y: origin.y + heights[column],
        width: layout.columnWidth,
        height,
      });
      heights[column] += height + gap;
    }
  } else {
    const columns = Math.max(1, layout.columns);
    const { cell, crop } = layout;
    // A cut image fills a cell of its cut's shape; a whole one sits in the middle of a square cell
    const cellHeight = crop !== undefined ? cell / CROP_ASPECTS[crop] : cell;
    shapes.forEach((shape, i) => {
      const aspect = crop !== undefined ? CROP_ASPECTS[crop] : aspectOf(shape);
      // As wide as the cell, or as high: whichever it reaches first
      const isWide = aspect >= cell / cellHeight;
      const width = isWide ? cell : cellHeight * aspect;
      const height = isWide ? cell / aspect : cellHeight;
      rects.push({
        x: origin.x + (i % columns) * (cell + gap) + (cell - width) / 2,
        y: origin.y + Math.floor(i / columns) * (cellHeight + gap) + (cellHeight - height) / 2,
        width,
        height,
      });
    });
  }
  return rects;
}

/**
 * The order in which someone would read them: row by row from the top, each row from left to right.
 * Things whose middles are less than half the height of the first of a row apart are in that row.
 */
export function readingOrder<T extends Rect>(rects: readonly T[]): T[] {
  const byTop = [...rects].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const order: T[] = [];
  let row: T[] = [];
  for (const rect of byTop) {
    const first = row[0];
    if (
      first !== undefined &&
      rect.y + rect.height / 2 - (first.y + first.height / 2) > first.height / 2
    ) {
      order.push(...row.sort((a, b) => a.x - b.x));
      row = [];
    }
    row.push(rect);
  }
  order.push(...row.sort((a, b) => a.x - b.x));
  return order;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** A number of rows or columns that makes about as wide a block as a monitor is for its height */
export function suggestedCount(kind: LayoutKind, count: number): number {
  const columns = Math.max(1, Math.round(Math.sqrt((count * 16) / 9)));
  return kind === 'rows' ? Math.max(1, Math.ceil(count / columns)) : Math.min(count, columns);
}

/** How a selection is laid out anew: besides the layout and the number of rows or columns */
export interface ArrangeOptions {
  /** The space between them, in units */
  gap: number;
  /** For a grid: the shape images are cut to; whole when not given */
  crop?: CropShape;
}

/** The shape something is laid out in: an image whole, in the shape of its photo, unless it is cut */
function layoutShape(item: WorkspaceItem): Size {
  return item.kind === 'image' ? { width: item.imageAspect, height: 1 } : item;
}

/**
 * Some of the objects laid out anew, in reading order, where the first of them was: in `count` rows, or
 * in `count` columns or a grid of `count` columns. They keep about the size they had (the middle one of
 * their sizes) and end up in front of everything else. Backgrounds stay where they are.
 */
export function arrangeItems(
  items: readonly WorkspaceItem[],
  ids: ReadonlySet<string>,
  kind: LayoutKind,
  count: number,
  options: ArrangeOptions = { gap: LAYOUT_GAP },
): WorkspaceItem[] {
  const chosen = readingOrder(
    items.filter((item) => ids.has(item.id) && item.kind !== 'background'),
  );
  const bounds = boundsOf(chosen);
  if (bounds === undefined) {
    return [...items];
  }
  const n = Math.max(1, Math.round(count));
  const { gap } = options;
  const shapes = chosen.map(layoutShape);
  let layout: WorkspaceLayout;
  if (kind === 'rows') {
    const rowHeight = median(chosen.map((item) => item.height));
    const widths = shapes.map((shape) => rowHeight * aspectOf(shape));
    const total = widths.reduce((sum, width) => sum + width + gap, 0);
    layout = { kind, gap, rowHeight, width: Math.max(total / n - gap, ...widths) };
  } else if (kind === 'columns') {
    layout = { kind, gap, columns: n, columnWidth: median(chosen.map((item) => item.width)) };
  } else {
    const cell = median(chosen.map((item) => Math.max(item.width, item.height)));
    layout = { kind, gap, columns: n, cell, crop: options.crop };
  }
  const rects = layOut(shapes, bounds, layout);
  let z = frontZ(items);
  const placed = new Map(
    chosen.map((item, i) => {
      const rect = rects[i];
      // A text gets letters of the size that fits; an image its new frame, cut or whole
      const sized = resizeItem(item, rect.width);
      return [item.id, { ...sized, x: rect.x, y: rect.y, height: rect.height, z: z++ }];
    }),
  );
  return items.map((item) => placed.get(item.id) ?? item);
}

/**
 * Two objects trade places: each goes to the middle of where the other was, as large as fits there in
 * its own shape (two cells of a grid simply trade). Both end up in front.
 */
export function swapItems(items: readonly WorkspaceItem[], a: string, b: string): WorkspaceItem[] {
  const first = items.find((item) => item.id === a);
  const second = items.find((item) => item.id === b);
  if (first === undefined || second === undefined || first === second) {
    return [...items];
  }
  const into = (item: WorkspaceItem, frame: Rect, z: number): WorkspaceItem => {
    const aspect = item.width / item.height;
    const width = Math.min(frame.width, frame.height * aspect);
    const sized = resizeItem(item, width);
    return {
      ...sized,
      x: frame.x + (frame.width - sized.width) / 2,
      y: frame.y + (frame.height - sized.height) / 2,
      z,
    };
  };
  const z = frontZ(items);
  const swapped = new Map([
    [first.id, into(first, second, z)],
    [second.id, into(second, first, z + 1)],
  ]);
  return items.map((item) => swapped.get(item.id) ?? item);
}

// Backgrounds

/** The shapes a background can have, as width for height; the first is the one a new one gets */
export const PAPER_FORMATS: readonly { name: string; aspect: number }[] = [
  { name: 'A4 portrait', aspect: 210 / 297 },
  { name: 'A4 landscape', aspect: 297 / 210 },
  { name: 'Letter portrait', aspect: 8.5 / 11 },
  { name: 'Letter landscape', aspect: 11 / 8.5 },
  { name: 'Square', aspect: 1 },
  { name: '4:5 portrait', aspect: 4 / 5 },
  { name: '3:2 landscape', aspect: 3 / 2 },
  { name: '2:3 portrait', aspect: 2 / 3 },
  { name: '16:9 landscape', aspect: 16 / 9 },
];

/** The colour of a new background: paper */
export const PAPER_COLOR = '#ffffff';

function aspectOfFormat(format: string): number {
  return (PAPER_FORMATS.find((f) => f.name === format) ?? PAPER_FORMATS[0]).aspect;
}

/** A sheet of paper with its middle at `center`, `height` high, at layer `z` */
export function createBackground(
  id: string,
  center: Point,
  height: number,
  z: number,
): WorkspaceBackgroundItem {
  const format = PAPER_FORMATS[0];
  const width = height * format.aspect;
  return {
    kind: 'background',
    id,
    color: PAPER_COLOR,
    format: format.name,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    z,
  };
}

/** A background of another colour or format; another format keeps its width and its top left */
export function changeBackground(
  item: WorkspaceBackgroundItem,
  changes: Partial<Pick<WorkspaceBackgroundItem, 'color' | 'format'>>,
): WorkspaceBackgroundItem {
  const changed = { ...item, ...changes };
  return { ...changed, height: changed.width / aspectOfFormat(changed.format) };
}

/**
 * What a sheet dragged over images can line up with as a whole: all the images it lies under, at least
 * two of them, as one block. The middle of an even grid is in a gap, which no single image lines up with.
 */
export function groupUnder(sheet: Rect, others: readonly WorkspaceItem[]): Rect | undefined {
  // Images only: the name of a batch above a grid would move its middle off the grid's
  const under = others.filter((other) => other.kind === 'image' && overlaps(sheet, other));
  return under.length >= 2 ? boundsOf(under) : undefined;
}

/** Whether `inner` lies wholly within `outer` */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// Snapping

/**
 * A line along which what is dragged lines up with something else, for as long as both reach (`line`); or
 * one of the gaps that are now of the same size (`gap`), across which it is drawn
 */
export interface SnapGuide {
  kind: 'line' | 'gap';
  /** For a line: vertical (x) or horizontal (y). For a gap: the gap is along x (side by side) or y */
  axis: 'x' | 'y';
  /** A line: the x of a vertical one, the y of a horizontal one. A gap: where across it is drawn */
  at: number;
  from: number;
  to: number;
}

/**
 * Moving `moving` by `dx, dy`, snapped so that one of its edges or its middle lines up with an edge or
 * the middle of one of the `others`, when it comes within `threshold` of it; each direction on its own.
 * Returns the move and the lines along which things line up.
 */
export function snapMove(
  moving: Rect,
  others: readonly Rect[],
  dx: number,
  dy: number,
  threshold: number,
  /** Groups to line up with as a whole, such as a grid of images a sheet is laid under */
  groups: readonly Rect[] = [],
): { dx: number; dy: number; guides: SnapGuide[] } {
  const targets = [...others, ...groups];
  const lines = (start: number, size: number) => [start, start + size / 2, start + size];
  const startOf = (rect: Rect, axis: 'x' | 'y') => (axis === 'x' ? rect.x : rect.y);
  const sizeOf = (rect: Rect, axis: 'x' | 'y') => (axis === 'x' ? rect.width : rect.height);

  /** The nearest move along one direction that lines an edge or middle up, or evens out a gap */
  const snapAxis = (axis: 'x' | 'y', offset: number) => {
    const start = startOf(moving, axis) + offset;
    const size = sizeOf(moving, axis);
    let best: number | undefined;
    const consider = (distance: number) => {
      if (
        Math.abs(distance) <= threshold &&
        (best === undefined || Math.abs(distance) < Math.abs(best))
      ) {
        best = distance;
      }
    };
    const lineUp = (with_: readonly Rect[]) => {
      for (const other of with_) {
        for (const target of lines(startOf(other, axis), sizeOf(other, axis))) {
          for (const line of lines(start, size)) {
            consider(target - line);
          }
        }
      }
    };
    // A group goes first: the middle of an even grid lies in a gap, with the edges of images a few
    // units to either side of it, which would otherwise win
    lineUp(groups);
    if (best === undefined) {
      lineUp(others);
      for (const position of evenPositions(axis, moving, offset, others)) {
        consider(position - start);
      }
    }
    return offset + (best ?? 0);
  };
  const snappedX = snapAxis('x', dx);
  const snappedY = snapAxis('y', dy);
  const moved = { ...moving, x: moving.x + snappedX, y: moving.y + snappedY };

  // The lines things now share, reaching from one end of them to the other
  const guides: SnapGuide[] = [];
  const epsilon = threshold / 100;
  for (const axis of ['x', 'y'] as const) {
    const across = axis === 'x' ? 'y' : 'x';
    for (const at of lines(startOf(moved, axis), sizeOf(moved, axis))) {
      const sharing = targets.filter((other) =>
        lines(startOf(other, axis), sizeOf(other, axis)).some(
          (line) => Math.abs(line - at) <= epsilon,
        ),
      );
      if (sharing.length > 0) {
        const all = [moved, ...sharing];
        guides.push({
          kind: 'line',
          axis,
          at,
          from: Math.min(...all.map((r) => startOf(r, across))),
          to: Math.max(...all.map((r) => startOf(r, across) + sizeOf(r, across))),
        });
      }
    }
    guides.push(...evenGaps(axis, moved, others, epsilon));
  }
  return { dx: snappedX, dy: snappedY, guides };
}

/**
 * The others that are side by side with `rect` along `axis` (they overlap it the other way), in order
 * along `axis`, and the gaps between them
 */
function neighbours(axis: 'x' | 'y', rect: Rect, others: readonly Rect[]) {
  const across = axis === 'x' ? 'y' : 'x';
  const start = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const end = (r: Rect) => (axis === 'x' ? r.x + r.width : r.y + r.height);
  const crossStart = (r: Rect) => (across === 'x' ? r.x : r.y);
  const crossEnd = (r: Rect) => (across === 'x' ? r.x + r.width : r.y + r.height);
  // Beside it, not under or over it: a sheet over images has no gaps to them to even out
  const inLine = others
    .filter((o) => crossStart(o) < crossEnd(rect) && crossStart(rect) < crossEnd(o))
    .filter((o) => !overlaps(o, rect))
    .sort((a, b) => start(a) - start(b));
  const gaps: number[] = [];
  for (let i = 1; i < inLine.length; i++) {
    const gap = start(inLine[i]) - end(inLine[i - 1]);
    if (gap > 0) {
      gaps.push(gap);
    }
  }
  return { inLine, gaps, start, end, crossStart, crossEnd };
}

/**
 * Where `moving` (moved by `offset` along `axis`) would start for its gap to a neighbour to equal a gap
 * that is already there between two others in the same line, or to sit in the middle between two
 */
function evenPositions(
  axis: 'x' | 'y',
  moving: Rect,
  offset: number,
  others: readonly Rect[],
): number[] {
  const rect =
    axis === 'x' ? { ...moving, x: moving.x + offset } : { ...moving, y: moving.y + offset };
  const { inLine, gaps, start, end } = neighbours(axis, rect, others);
  const size = axis === 'x' ? moving.width : moving.height;
  const positions: number[] = [];
  for (const other of inLine) {
    for (const gap of gaps) {
      positions.push(end(other) + gap, start(other) - gap - size);
    }
  }
  for (let i = 1; i < inLine.length; i++) {
    const room = start(inLine[i]) - end(inLine[i - 1]);
    if (room > size) {
      positions.push(end(inLine[i - 1]) + (room - size) / 2);
    }
  }
  return positions;
}

/** The gaps next to `moved` that are as large as another gap in its line, to be shown as equal */
function evenGaps(
  axis: 'x' | 'y',
  moved: Rect,
  others: readonly Rect[],
  epsilon: number,
): SnapGuide[] {
  const { inLine, start, end, crossStart, crossEnd } = neighbours(axis, moved, others);
  const all = [...inLine, moved].sort((a, b) => start(a) - start(b));
  const gapBetween = (a: Rect, b: Rect) => start(b) - end(a);
  const guideFor = (a: Rect, b: Rect): SnapGuide => ({
    kind: 'gap',
    axis,
    // Across the middle of where the two overlap
    at: (Math.max(crossStart(a), crossStart(b)) + Math.min(crossEnd(a), crossEnd(b))) / 2,
    from: end(a),
    to: start(b),
  });
  const pairs: [Rect, Rect][] = [];
  for (let i = 1; i < all.length; i++) {
    if (gapBetween(all[i - 1], all[i]) > 0) {
      pairs.push([all[i - 1], all[i]]);
    }
  }
  const ownPairs = pairs.filter(([a, b]) => a === moved || b === moved);
  const guides: SnapGuide[] = [];
  for (const own of ownPairs) {
    const size = gapBetween(own[0], own[1]);
    const same = pairs.filter(
      (pair) => pair !== own && Math.abs(gapBetween(pair[0], pair[1]) - size) <= epsilon,
    );
    if (same.length > 0) {
      guides.push(guideFor(own[0], own[1]), ...same.map(([a, b]) => guideFor(a, b)));
    }
  }
  // The same gap may be found from both sides of what is moved
  return guides.filter(
    (guide, i) =>
      guides.findIndex((g) => g.from === guide.from && g.to === guide.to && g.at === guide.at) ===
      i,
  );
}

// Texts

/** How wide a line of text is, in units, with letters of a size: measured where it is drawn */
export type MeasureText = (line: string, fontSize: number) => number;

/** The height of a line of text, as a part of the size of its letters */
export const TEXT_LINE_HEIGHT = 1.25;
/** The smallest letters a text can be given, in units */
export const MIN_FONT_SIZE = 4;

/** The size a text takes up with letters of this size */
export function textSize(text: string, fontSize: number, measure: MeasureText): Size {
  const lines = text.split('\n');
  return {
    width: Math.max(fontSize / 2, ...lines.map((line) => measure(line, fontSize))),
    height: lines.length * fontSize * TEXT_LINE_HEIGHT,
  };
}

export function createText(
  id: string,
  text: string,
  at: Point,
  z: number,
  measure: MeasureText,
  fontSize = LABEL_FONT_SIZE,
): WorkspaceTextItem {
  return {
    kind: 'text',
    id,
    text,
    color: '',
    fontSize,
    z,
    ...at,
    ...textSize(text, fontSize, measure),
  };
}

/** A text with other words, letters or colour; its size follows */
export function changeText(
  item: WorkspaceTextItem,
  changes: Partial<Pick<WorkspaceTextItem, 'text' | 'color' | 'fontSize'>>,
  measure: MeasureText,
): WorkspaceTextItem {
  const fontSize = Math.max(MIN_FONT_SIZE, changes.fontSize ?? item.fontSize);
  const changed = { ...item, ...changes, fontSize };
  return { ...changed, ...textSize(changed.text, fontSize, measure) };
}

// Back to front: the layers

/** The `z` that puts something in front of everything else */
export function frontZ(items: readonly WorkspaceItem[]): number {
  let max = -1;
  for (const item of items) {
    max = Math.max(max, item.z);
  }
  return max + 1;
}

/**
 * Something brought in front of all the rest. Returns the same list when it is already in front of
 * everything it overlaps, so that a click on what is on top changes (and stores) nothing.
 */
export function bringToFront(
  items: readonly WorkspaceItem[],
  id: string,
): readonly WorkspaceItem[] {
  const item = items.find((i) => i.id === id);
  // A background stays under what lies on it
  if (item === undefined || item.kind === 'background') {
    return items;
  }
  const isCovered = items.some(
    (other) => other !== item && other.z > item.z && overlaps(item, other),
  );
  if (!isCovered) {
    return items;
  }
  const z = frontZ(items);
  return items.map((i) => (i === item ? { ...i, z } : i));
}

/**
 * Objects moved by `dx, dy`. They end up in front of all the others, as something put down on a table
 * lies on top, in the same order among themselves.
 */
export function moveItems(
  items: readonly WorkspaceItem[],
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): WorkspaceItem[] {
  let z = frontZ(items);
  const moved = items
    .filter((item) => ids.has(item.id))
    .sort((a, b) => a.z - b.z)
    // A background keeps its layer, under what lies on it
    .map((item) => ({
      ...item,
      x: item.x + dx,
      y: item.y + dy,
      z: item.kind === 'background' ? item.z : z++,
    }));
  const byId = new Map(moved.map((item) => [item.id, item]));
  return items.map((item) => byId.get(item.id) ?? item);
}

/** The layers from the top down, as the layers panel lists them */
export function layersFromTop(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort((a, b) => b.z - a.z);
}

/**
 * The objects `ids` put at `toIndex` of the layers from the top down (counted without them), in their own
 * order. Every layer gets its `z` anew, from 0 at the bottom.
 */
export function moveLayers(
  items: readonly WorkspaceItem[],
  ids: ReadonlySet<string>,
  toIndex: number,
): WorkspaceItem[] {
  const topDown = layersFromTop(items);
  const moved = topDown.filter((item) => ids.has(item.id));
  const others = topDown.filter((item) => !ids.has(item.id));
  const at = Math.max(0, Math.min(others.length, toIndex));
  const order = [...others.slice(0, at), ...moved, ...others.slice(at)];
  const zOf = new Map(order.map((item, i) => [item.id, order.length - 1 - i]));
  return items.map((item) => {
    const z = zOf.get(item.id)!;
    return item.z === z ? item : { ...item, z };
  });
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The smallest an image can be made, in world units */
export const MIN_ITEM_WIDTH = 16;

/** At another width, in the same shape; the letters of a text grow or shrink along */
export function resizeItem<T extends WorkspaceItem>(item: T, width: number): T {
  const newWidth = Math.max(MIN_ITEM_WIDTH, width);
  const scale = newWidth / item.width;
  if (item.kind === 'text') {
    return {
      ...item,
      width: newWidth,
      height: item.height * scale,
      fontSize: item.fontSize * scale,
    };
  }
  return { ...item, width: newWidth, height: item.height * scale };
}

// What is in view

/**
 * Finds the objects in a part of the world without looking at all of them: every object is listed in the
 * square cells of the world that it touches.
 */
export class SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly rects = new Map<string, Rect>();

  constructor(private readonly cellSize = 1024) {}

  get size(): number {
    return this.rects.size;
  }

  set(id: string, rect: Rect): void {
    this.delete(id);
    this.rects.set(id, rect);
    this.forEachCell(rect, (key) => {
      let cell = this.cells.get(key);
      if (cell === undefined) {
        cell = new Set();
        this.cells.set(key, cell);
      }
      cell.add(id);
    });
  }

  delete(id: string): void {
    const rect = this.rects.get(id);
    if (rect === undefined) {
      return;
    }
    this.rects.delete(id);
    this.forEachCell(rect, (key) => {
      const cell = this.cells.get(key);
      cell?.delete(id);
      if (cell?.size === 0) {
        this.cells.delete(key);
      }
    });
  }

  /** The ids of the objects that overlap `area` */
  query(area: Rect): Set<string> {
    const found = new Set<string>();
    const add = (id: string) => {
      const rect = this.rects.get(id);
      if (rect !== undefined && overlaps(rect, area)) {
        found.add(id);
      }
    };
    // Zoomed far out, the area covers more cells than there are objects: then they are simply all checked
    if (this.cellCount(area) > this.rects.size) {
      this.rects.forEach((_, id) => add(id));
    } else {
      this.forEachCell(area, (key) => this.cells.get(key)?.forEach(add));
    }
    return found;
  }

  private cellCount(rect: Rect): number {
    const columns =
      Math.floor((rect.x + rect.width) / this.cellSize) - Math.floor(rect.x / this.cellSize);
    const rows =
      Math.floor((rect.y + rect.height) / this.cellSize) - Math.floor(rect.y / this.cellSize);
    return (columns + 1) * (rows + 1);
  }

  private forEachCell(rect: Rect, visit: (key: string) => void): void {
    const left = Math.floor(rect.x / this.cellSize);
    const top = Math.floor(rect.y / this.cellSize);
    const right = Math.floor((rect.x + rect.width) / this.cellSize);
    const bottom = Math.floor((rect.y + rect.height) / this.cellSize);
    for (let column = left; column <= right; column++) {
      for (let row = top; row <= bottom; row++) {
        visit(`${column},${row}`);
      }
    }
  }
}

// The grid

/** Each level of the grid is this many times finer than the one above it */
const GRID_STEP = 4;
/** Lines closer together than this on the screen are not drawn: they would be a grey wash */
const MIN_GRID_SPACING = 12;

/**
 * The two levels of the grid at a zoom: fine lines, which fade in as they spread apart, and the stronger
 * lines every `GRID_STEP` fine ones. Spacing is in world units; on the screen the fine lines are between
 * `MIN_GRID_SPACING` and `GRID_STEP` times that apart, at every zoom.
 */
export function gridLevels(zoom: number): { fine: number; fineOpacity: number; major: number } {
  const level = Math.ceil(Math.log(MIN_GRID_SPACING / zoom) / Math.log(GRID_STEP) - 1e-9);
  const fine = Math.pow(GRID_STEP, level);
  const fineOpacity = Math.log((fine * zoom) / MIN_GRID_SPACING) / Math.log(GRID_STEP);
  return { fine, fineOpacity: Math.min(1, Math.max(0, fineOpacity)), major: fine * GRID_STEP };
}

// Storage

/** The room above a batch for its name in the version that stored names apart from the images */
const EARLIER_LABEL_SPACE = 40;

/**
 * A workspace as read back from the database. Anything that is not as expected is left out or set to its
 * default, so that one damaged row can not keep the others from opening. Workspaces stored before texts
 * were objects have images without a kind, and the names of their batches apart: those become texts.
 */
export function workspaceFromRow(row: unknown, measure: MeasureText): WorkspaceRow | undefined {
  if (typeof row !== 'object' || row === null) {
    return undefined;
  }
  const { id, name, index, items, camera, isLocked } = row as Partial<WorkspaceRow>;
  const { groups } = row as { groups?: unknown };
  if (typeof id !== 'string') {
    return undefined;
  }
  const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const validItems: WorkspaceItem[] = [];
  for (const stored of Array.isArray(items) ? items : []) {
    // As it may have been stored, by this version or an earlier one
    const item = (stored ?? {}) as unknown as Record<string, unknown>;
    const { x, y, z, width, height, kind, fileId, text, color, fontSize, imageAspect, format } =
      item;
    if (
      !isNumber(x) ||
      !isNumber(y) ||
      !isNumber(z) ||
      !isNumber(width) ||
      !isNumber(height) ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }
    if (kind === 'text' && typeof item.id === 'string' && typeof text === 'string') {
      validItems.push({
        kind: 'text',
        id: item.id,
        text,
        color: typeof color === 'string' ? color : '',
        fontSize: isNumber(fontSize) ? fontSize : LABEL_FONT_SIZE,
        x,
        y,
        z,
        width,
        height,
      });
    } else if (kind === 'background' && typeof item.id === 'string') {
      validItems.push({
        kind: 'background',
        id: item.id,
        color: typeof color === 'string' ? color : PAPER_COLOR,
        format: typeof format === 'string' ? format : PAPER_FORMATS[0].name,
        x,
        y,
        z,
        width,
        height,
      });
    } else if (
      kind !== 'text' &&
      kind !== 'background' &&
      typeof fileId === 'string' &&
      // An image is on a workspace once
      !validItems.some((other) => other.id === fileId)
    ) {
      // Stored before images remembered the shape of their photo: the shape of their frame
      const aspect = isNumber(imageAspect) && imageAspect > 0 ? imageAspect : width / height;
      validItems.push({
        kind: 'image',
        id: fileId,
        fileId,
        imageAspect: aspect,
        x,
        y,
        z,
        width,
        height,
      });
    }
  }
  let z = frontZ(validItems);
  for (const group of (Array.isArray(groups) ? groups : []) as Partial<
    Point & { label: string }
  >[]) {
    if (typeof group?.label === 'string' && isNumber(group.x) && isNumber(group.y)) {
      // Its foot where the images begin, as it was drawn
      const at = {
        x: group.x,
        y: group.y + EARLIER_LABEL_SPACE - LABEL_FONT_SIZE * TEXT_LINE_HEIGHT - LAYOUT_GAP,
      };
      validItems.push(createText(`${id}-label-${z}`, group.label, at, z++, measure));
    }
  }
  const validCamera =
    camera !== undefined && isNumber(camera.x) && isNumber(camera.y) && isNumber(camera.zoom)
      ? { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) }
      : START_CAMERA;
  return {
    id,
    name: typeof name === 'string' && name.trim().length > 0 ? name : 'Workspace',
    index: isNumber(index) ? index : 0,
    items: validItems,
    camera: validCamera,
    isLocked: isLocked === true,
  };
}

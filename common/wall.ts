/**
 * A wall of photos (`extend` in the Director, `ClientWorkspace.extend`): the photos of a workspace repeated in
 * masonry columns to the left and right of its block, and above and below it, so that the photos look as if
 * they went on in every direction. The columns are the ones the photos are in (`columnShapeOf`). A copy never
 * sits next to a copy of its own photo: not the photo directly above or below it in its column, and not one in
 * the next column that comes within a gap of it. Nothing that is there moves.
 */
import { seededRandom, shuffled } from './core';
import type { Crop } from './crop';
import {
  boundsOf,
  LAYOUT_GAP,
  originalsOf,
  overlaps,
  Point,
  Rect,
  WorkspaceImageItem,
  WorkspaceItem,
} from './workspace';

/** A photo of the workspace, as a wall can repeat it: a copy looks like it, cropped the same way */
export interface WallPhoto {
  fileId: string;
  /** Width for height of the photo */
  imageAspect: number;
  /** Width for height of the shape it is shown in, which its crop cuts it to: the copies take this shape */
  frameAspect: number;
  crop?: Crop;
  subject?: Point;
}

/** Something on the workspace that a wall keeps off: a photo (with its file) or a text */
export type WallObstacle = Rect & { fileId?: string };

export interface WallOptions {
  /** Columns on each side of the block */
  columns: number;
  /** How far the columns go above the top of the block, and below its bottom, in pixels */
  above: number;
  below: number;
  /** Which photos come first, and in what order: the same seed makes the same wall */
  seed: number;
}

export interface WallCopy extends Rect {
  fileId: string;
  imageAspect: number;
  crop?: Crop;
  subject?: Point;
}

/** A guard against a stack that never reaches its end: far more places than a wall has */
const MAX_STEPS = 100_000;

/** Something placed, and the column it is in when it is a photo */
interface Placed {
  rect: Rect;
  fileId?: string;
  column?: number;
}

const bottomOf = (placed: Placed) => placed.rect.y + placed.rect.height;

/**
 * The width of the columns the photos are in, and the space between them. A photo's column is one of the
 * columns of a layout in columns: as wide as the others, and beside them at a fixed step
 */
export function columnShapeOf(images: readonly Rect[]): { columnWidth: number; gap: number } {
  if (images.length === 0) {
    throw new Error('A wall takes photos');
  }
  const widths = images.map((image) => image.width).sort((a, b) => a - b);
  const columnWidth = widths[Math.floor(widths.length / 2)];
  if (images.some((image) => Math.abs(image.width - columnWidth) > 1)) {
    throw new Error('The photos are not in columns: arrange them in columns first');
  }
  const lefts = [...new Set(images.map((image) => image.x))].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < lefts.length; i++) {
    step = Math.min(step, lefts[i] - lefts[i - 1]);
  }
  const gap = step === Infinity ? LAYOUT_GAP : Math.round(step - columnWidth);
  return { columnWidth, gap: gap >= 0 ? gap : LAYOUT_GAP };
}

/**
 * The copies of `photos` that make the wall around `obstacles`, in columns `columnWidth` wide with `gap`
 * between them. The block's columns continue above its top and below its bottom (above a text too), and
 * the columns beside it run from the top to the bottom of the wall. Each stack takes the photos in the order
 * of `options.seed`, moving on past anything in the way and past a photo that would sit next to its own copy
 */
export function wallOfCopies(
  obstacles: readonly WallObstacle[],
  photos: readonly WallPhoto[],
  columnWidth: number,
  gap: number,
  options: WallOptions,
): WallCopy[] {
  const images = obstacles.filter((obstacle) => obstacle.fileId !== undefined);
  const order = shuffled(
    photos.filter((photo) => photo.imageAspect > 0 && photo.frameAspect > 0),
    seededRandom(options.seed),
  );
  const block = boundsOf(obstacles);
  if (images.length === 0 || order.length === 0 || block === undefined) {
    return [];
  }
  if (!(columnWidth > 0)) {
    throw new Error('A column is as wide as a photo: wider than nothing');
  }
  const step = columnWidth + gap;
  const originX = images.reduce((left, image) => Math.min(left, image.x), Infinity);
  const columnOf = (x: number) => Math.round((x - originX) / step);
  const columns = images.map((image) => columnOf(image.x));
  const first = columns.reduce((min, column) => Math.min(min, column), Infinity);
  const last = columns.reduce((max, column) => Math.max(max, column), -Infinity);
  const top = block.y - options.above;
  const bottom = block.y + block.height + options.below;

  const placed: Placed[] = obstacles.map((obstacle) => ({
    rect: obstacle,
    fileId: obstacle.fileId,
    column: obstacle.fileId !== undefined ? columnOf(obstacle.x) : undefined,
  }));
  const copies: WallCopy[] = [];
  let next = 0;

  /** Whether a photo at `rect` in `column` would sit next to a copy of its own photo */
  const sitsNextToOwn = (fileId: string, rect: Rect, column: number): boolean => {
    // The nearest in its column above and below
    let above: Placed | undefined;
    let below: Placed | undefined;
    for (const other of placed) {
      if (other.column !== column) {
        continue;
      }
      if (bottomOf(other) <= rect.y && (above === undefined || bottomOf(other) > bottomOf(above))) {
        above = other;
      }
      if (
        other.rect.y >= rect.y + rect.height &&
        (below === undefined || other.rect.y < below.rect.y)
      ) {
        below = other;
      }
    }
    if (above?.fileId === fileId || below?.fileId === fileId) {
      return true;
    }
    // Or in the next column, within a gap of it
    return placed.some(
      (other) =>
        other.fileId === fileId &&
        other.column !== undefined &&
        Math.abs(other.column - column) === 1 &&
        other.rect.y < rect.y + rect.height + gap &&
        rect.y < bottomOf(other) + gap,
    );
  };

  /**
   * Copies stacked in `column` from `from` towards `limit`: down (`direction` 1, `from` the top of the first)
   * or up (-1, `from` its bottom). Each takes the next photo in order that fits the room and its neighbours
   */
  const stack = (column: number, from: number, limit: number, direction: 1 | -1) => {
    const x = originX + column * step;
    let y = from;
    for (let steps = 0; steps < MAX_STEPS; steps++) {
      let found: { index: number; photo: WallPhoto; rect: Rect } | undefined;
      let blocker: Placed | undefined;
      let reachable = false;
      for (let t = 0; t < order.length && found === undefined && blocker === undefined; t++) {
        const index = (next + t) % order.length;
        const photo = order[index];
        const height = Math.max(1, Math.floor(columnWidth / photo.frameAspect));
        const rect = { x, y: direction === 1 ? y : y - height, width: columnWidth, height };
        if (direction === 1 ? rect.y + height > limit : rect.y < limit) {
          continue;
        }
        reachable = true;
        blocker = placed.find((other) => overlaps(other.rect, rect));
        if (blocker === undefined && !sitsNextToOwn(photo.fileId, rect, column)) {
          found = { index, photo, rect };
        }
      }
      if (!reachable) {
        return;
      }
      if (blocker !== undefined) {
        const edge = blocker.rect;
        y = direction === 1 ? edge.y + edge.height + gap : edge.y - gap;
      } else if (found === undefined) {
        // Every photo that fits would sit next to its own copy here: on to the next place
        y += direction * Math.max(1, gap);
      } else {
        const { photo, rect } = found;
        const { fileId, imageAspect, crop, subject } = photo;
        copies.push({ ...rect, fileId, imageAspect, crop, subject });
        placed.push({ rect, fileId: photo.fileId, column });
        next = (found.index + 1) % order.length;
        y = direction === 1 ? rect.y + rect.height + gap : rect.y - gap;
      }
    }
  };

  for (let column = first - options.columns; column <= last + options.columns; column++) {
    const x = originX + column * step;
    // What is in this column: the block's own, which its columns continue from above and below
    const beside = placed.filter(
      (other) => other.rect.x < x + columnWidth && x < other.rect.x + other.rect.width,
    );
    if (column < first || column > last || beside.length === 0) {
      stack(column, top, bottom, 1);
      continue;
    }
    const highest = beside.reduce((min, other) => Math.min(min, other.rect.y), Infinity);
    const lowest = beside.reduce((max, other) => Math.max(max, bottomOf(other)), -Infinity);
    stack(column, highest - gap, top, -1);
    stack(column, lowest + gap, bottom, 1);
  }
  return copies;
}

/**
 * The copies of a workspace's photos as items to add after its own, with new ids from `newId` and `z` counting
 * up from `firstZ`. Its photos are the ones in `items` (each file once), their columns those they are in; the
 * sheets behind everything are not in the way
 */
export function wallItems(
  items: readonly WorkspaceItem[],
  options: WallOptions,
  newId: () => string,
  firstZ: number,
): WorkspaceImageItem[] {
  const images = items.filter((item): item is WorkspaceImageItem => item.kind === 'image');
  const { columnWidth, gap } = columnShapeOf(images);
  const photos = originalsOf(images).map(
    (image): WallPhoto => ({
      fileId: image.fileId,
      imageAspect: image.imageAspect,
      frameAspect: image.width / image.height,
      crop: image.crop,
      subject: image.subject,
    }),
  );
  const obstacles = items.filter((item) => item.kind !== 'background');
  return wallOfCopies(obstacles, photos, columnWidth, gap, options).map((copy, i) => ({
    kind: 'image',
    id: newId(),
    fileId: copy.fileId,
    imageAspect: copy.imageAspect,
    crop: copy.crop,
    subject: copy.subject,
    x: copy.x,
    y: copy.y,
    width: copy.width,
    height: copy.height,
    z: firstZ + i,
  }));
}

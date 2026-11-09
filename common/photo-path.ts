/**
 * A path through photos for a video's camera to pan along: the wide ones in short rows, the tall ones in
 * short columns, in turn. Each leg turns off the end of the one before, to one side or the other at
 * random, never into what is to be kept clear when the other side is free. A row is as high as the
 * camera's frame and a column as wide, so the frame keeps its size all the way and only moves. A leg may
 * run over photos laid before: those are to be hidden before the camera gets there.
 */
import { seededRandom } from './core';
import { boundsOf, overlaps, Point, Rect } from './workspace';

export interface PathPhoto {
  id: string;
  /** Its width over its height */
  aspect: number;
}

export type PathDirection = 'right' | 'down' | 'left' | 'up';

export interface PathLeg {
  direction: PathDirection;
  photos: string[];
  /** Photos of the legs before that lie where this one goes: hidden before it begins */
  hides: string[];
  /** Where the camera is at its end, against the far edge of its last photo */
  frame: Rect;
}

export interface PhotoPath {
  places: Map<string, Rect>;
  /** Where the camera is at the start, against the near edge of the first photo */
  start: Rect;
  legs: PathLeg[];
}

export interface PathOptions {
  /** The top left of the first photo */
  origin: Point;
  /** The height of a row; a column is as wide as a frame of the video's shape that high */
  rowHeight: number;
  /** The video's width over its height */
  aspect: number;
  gap: number;
  seed: number;
  /** What the path stays out of when it can */
  avoid?: readonly Rect[];
  /**
   * 'random' (the default): each leg turns to one side or the other. 'loop': always right, down, left, up,
   * round and round over the same ground, the photos of earlier rounds hidden as it comes back to them
   */
  turns?: 'random' | 'loop';
}

/** The fewest tall photos in a column: fewer would bring the next row back over the one before */
const MIN_COLUMN = 2;
/** About how many photos a leg of a loop runs over */
const LOOP_LEG = 3;
/** The order a loop turns in */
const LOOP: PathDirection[] = ['right', 'down', 'left', 'up'];
/** The frame a little inside a row or column, so that the edges of its photos never show */
const INSET = 0.99;

export function photoPath(photos: readonly PathPhoto[], options: PathOptions): PhotoPath {
  const { origin, rowHeight, aspect, gap, avoid = [], turns = 'random' } = options;
  const random = seededRandom(options.seed);
  const cell = { width: rowHeight * aspect, height: rowHeight };
  const groups = turns === 'loop' ? loopGroups(photos) : randomGroups(photos);

  const places = new Map<string, Rect>();
  const hidden = new Set<string>();
  const legs: PathLeg[] = [];
  const isRow = (direction: PathDirection) => direction === 'right' || direction === 'left';
  // The first leg is laid beyond a cell just before the origin, as every other is beyond the last.
  // A row first: a loop's always is one, others unless there is no wide photo to begin it with
  const first: PathDirection =
    turns === 'loop' || groups[0]?.some((photo) => photo.aspect > 1) ? 'right' : 'down';
  let at: Rect = isRow(first)
    ? { x: origin.x - cell.width - gap, y: origin.y, ...cell }
    : { x: origin.x, y: origin.y - cell.height - gap, ...cell };
  let direction: PathDirection = first;
  let start: Rect | undefined;

  for (const group of groups) {
    if (legs.length > 0 && turns === 'loop') {
      direction = LOOP[(LOOP.indexOf(first) + legs.length) % LOOP.length];
    } else if (legs.length > 0) {
      const sides: PathDirection[] = isRow(direction) ? ['down', 'up'] : ['right', 'left'];
      const free = sides.filter((side) => {
        const area = boundsOf(lay(group, at, side, cell, gap));
        return area !== undefined && !avoid.some((rect) => overlaps(rect, area));
      });
      const choices = free.length > 0 ? free : sides;
      direction = choices[Math.floor(random() * choices.length)];
    }
    const rects = lay(group, at, direction, cell, gap);
    const area = boundsOf(rects)!;
    const hides = [...places]
      .filter(([id, rect]) => !hidden.has(id) && overlaps(rect, area))
      .map(([id]) => id);
    hides.forEach((id) => hidden.add(id));
    group.forEach((photo, i) => places.set(photo.id, rects[i]));
    const end = endCell(area, direction, cell);
    start ??= startCell(area, direction, cell);
    legs.push({ direction, photos: group.map((photo) => photo.id), hides, frame: inset(end) });
    at = end;
  }
  return { places, start: inset(start ?? { ...origin, ...cell }), legs };
}

/** Rows of the wide photos and columns of the tall ones in turn, as many columns as there are tall ones for */
function randomGroups(photos: readonly PathPhoto[]): PathPhoto[][] {
  const wide = photos.filter((photo) => photo.aspect > 1);
  const tall = photos.filter((photo) => photo.aspect <= 1);
  const columns = Math.min(Math.floor(tall.length / MIN_COLUMN), Math.max(0, wide.length - 1));
  const rows = Math.min(wide.length, columns + 1);
  // Too few for a column, or no wide ones: all of them in one row (one column)
  return columns > 0
    ? interleave(splitInto(wide, rows), splitInto(tall, columns))
    : [[...wide, ...tall]].filter((group) => group.length > 0);
}

/**
 * Rows and columns in turn, about `LOOP_LEG` photos each, so that a loop goes round more than once: the wide
 * photos in the rows and the tall ones in the columns. When one kind is short, the other fills in: wide photos
 * stacked in a column, tall ones side by side in a row
 */
function loopGroups(photos: readonly PathPhoto[]): PathPhoto[][] {
  const legs = Math.max(1, Math.round(photos.length / LOOP_LEG));
  const rows = Math.ceil(legs / 2);
  const columns = legs - rows;
  const forRows = photos.filter((photo) => photo.aspect > 1);
  const forColumns = photos.filter((photo) => photo.aspect <= 1);
  // A column takes at least `MIN_COLUMN`, else the next row comes back over the one before; a row one
  while (forColumns.length < columns * MIN_COLUMN && forRows.length > rows) {
    forColumns.push(forRows.pop()!);
  }
  while (forRows.length < rows && forColumns.length > columns * MIN_COLUMN) {
    forRows.push(forColumns.pop()!);
  }
  return interleave(splitInto(forRows, rows), splitInto(forColumns, columns)).filter(
    (group) => group.length > 0,
  );
}

/** The photos laid one after another beyond `cell` (the camera's place) in `direction` */
function lay(
  group: readonly PathPhoto[],
  cell: Rect,
  direction: PathDirection,
  size: { width: number; height: number },
  gap: number,
): Rect[] {
  const forward = direction === 'right' || direction === 'down';
  const isRow = direction === 'right' || direction === 'left';
  let cursor = isRow
    ? forward
      ? cell.x + cell.width + gap
      : cell.x - gap
    : forward
    ? cell.y + cell.height + gap
    : cell.y - gap;
  return group.map((photo) => {
    const length = isRow ? size.height * photo.aspect : size.width / photo.aspect;
    const from = forward ? cursor : cursor - length;
    cursor = forward ? cursor + length + gap : cursor - length - gap;
    return isRow
      ? { x: from, y: cell.y, width: length, height: size.height }
      : { x: cell.x, y: from, width: size.width, height: length };
  });
}

/** The camera's place at the far end of a leg laid over `area` */
function endCell(area: Rect, direction: PathDirection, size: { width: number; height: number }) {
  switch (direction) {
    case 'right':
      return { x: area.x + area.width - size.width, y: area.y, ...size };
    case 'left':
      return { x: area.x, y: area.y, ...size };
    case 'down':
      return { x: area.x, y: area.y + area.height - size.height, ...size };
    case 'up':
      return { x: area.x, y: area.y, ...size };
  }
}

/** The camera's place at the near end of a leg laid over `area` */
function startCell(area: Rect, direction: PathDirection, size: { width: number; height: number }) {
  const opposite = { right: 'left', left: 'right', down: 'up', up: 'down' } as const;
  return endCell(area, opposite[direction], size);
}

function inset(rect: Rect): Rect {
  const width = rect.width * INSET;
  const height = rect.height * INSET;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

/** `items` in `parts` runs of nearly the same length, the longer ones first */
function splitInto<T>(items: readonly T[], parts: number): T[][] {
  const runs: T[][] = [];
  let from = 0;
  for (let i = 0; i < parts; i++) {
    const length = Math.floor(items.length / parts) + (i < items.length % parts ? 1 : 0);
    runs.push(items.slice(from, from + length));
    from += length;
  }
  return runs;
}

/** a1, b1, a2, b2, ... and what is left of the longer */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]])
    .flat()
    .filter((item): item is T => item !== undefined);
}

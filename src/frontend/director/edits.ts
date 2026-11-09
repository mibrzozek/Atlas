/**
 * The Director's edits of a video, in the page (development only, see `index.ts`): what a command's
 * changes of a shot or a motion mean, checked before anything is changed. Photos, shots, layouts and
 * motions are numbered from 1, in the order `timeline` lists them.
 */
import { ARRIVALS, EASINGS, frameAround, frameFilledBy, frameInShape, STAYS } from 'common/video';
import { isMotionKind, Motion } from 'common/video-motion';
import { boundsOf, Rect } from 'common/workspace';

/** What a shot shows (one of photo, photos, title, all, frame), then moved or zoomed; and its settings */
export interface ShotChanges {
  /** Filled by this photo; with `room`, all of it with that much room around it (of its size) */
  photo?: number;
  /** Filled by the photo against its start (left, or top) or end: a shot to the other end pans over it */
  align?: string;
  photos?: number[];
  title?: boolean;
  all?: boolean;
  /** Exactly here on the workspace: x, y, width, height (made the video's shape) */
  frame?: number[];
  room?: number;
  /** Moved by a part of its width and height: [0.1, 0] is a tenth of the frame to the right */
  move?: number[];
  /** Closer (2: half as wide) or further away (0.5) around its middle */
  zoom?: number;
  length?: number;
  arrival?: string;
  arrivalTime?: number;
  stay?: string;
  easing?: string;
}

export interface MotionChanges {
  kind?: string;
  /** Photo numbers, or 'all' */
  photos?: number[] | 'all';
  start?: number;
  length?: number;
  strength?: number;
  speed?: number;
  stagger?: number;
}

/** Where the photos and the texts are at a moment of the video, by id; the photos in their numbers' order */
export interface Places {
  photos: string[];
  texts: string[];
  at: ReadonlyMap<string, Rect>;
}

/** A number of a command, or why not: never NaN, never outside what makes sense */
export function numberOf(value: unknown, name: string, min: number, max: number): number {
  const n = Number(value);
  if (typeof value === 'boolean' || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} is a number from ${min} to ${max}`);
  }
  return n;
}

/** The thing numbered `n` (from 1) of a list */
export function numbered<T>(list: readonly T[], n: unknown, name: string): T {
  if (list.length === 0) {
    throw new Error(`It has no ${name}s`);
  }
  return list[numberOf(n, `The ${name}`, 1, list.length) - 1];
}

/** The ids of photos by their numbers, or all of them */
export function photoIds(places: Places, numbers: unknown): string[] {
  if (numbers === 'all') {
    return places.photos;
  }
  if (!Array.isArray(numbers) || numbers.length === 0) {
    throw new Error('photos is a list of photo numbers, or "all"');
  }
  return [...new Set(numbers.map((n) => numbered(places.photos, n, 'photo')))];
}

/** The settings of a shot that are not where it is, checked */
export function shotSettings(changes: ShotChanges) {
  const { arrival, stay, easing, arrivalTime } = changes;
  if (arrival !== undefined && !ARRIVALS.some((a) => a.arrival === arrival)) {
    throw new Error(`arrival is ${ARRIVALS.map((a) => a.arrival).join(', ')}`);
  }
  if (stay !== undefined && !STAYS.some((s) => s.stay === stay)) {
    throw new Error(`stay is ${STAYS.map((s) => s.stay).join(', ')}`);
  }
  if (easing !== undefined && !EASINGS.some((e) => e.easing === easing)) {
    throw new Error(`easing is ${EASINGS.map((e) => e.easing).join(', ')}`);
  }
  return withoutUndefined({
    arrival: arrival as (typeof ARRIVALS)[number]['arrival'] | undefined,
    stay: stay as (typeof STAYS)[number]['stay'] | undefined,
    easing: easing as (typeof EASINGS)[number]['easing'] | undefined,
    arrivalTime:
      arrivalTime !== undefined ? numberOf(arrivalTime, 'arrivalTime', 0, 10) : undefined,
  });
}

/** Whether the changes move the shot (anything but its settings and length) */
export const isFraming = (changes: ShotChanges): boolean =>
  ['photo', 'photos', 'title', 'all', 'frame', 'move', 'zoom'].some(
    (key) => changes[key as keyof ShotChanges] !== undefined,
  );

/** Where a shot is after `changes`, from where it is (`frame`), with the places of the moment it shows */
export function shotFrame(frame: Rect, aspect: number, changes: ShotChanges, places: Places): Rect {
  const what = (['photo', 'photos', 'title', 'all', 'frame'] as const).filter(
    (key) => changes[key] !== undefined && changes[key] !== false,
  );
  if (what.length > 1) {
    throw new Error('A shot shows one of photo, photos, title, all or frame');
  }
  const room = changes.room !== undefined ? numberOf(changes.room, 'room', 0, 2) : undefined;
  const { align = 'middle' } = changes;
  if (
    !isAlign(align) ||
    (changes.align !== undefined && (changes.photo === undefined || room !== undefined))
  ) {
    throw new Error('align is start, middle or end, of a photo that fills the shot (no room)');
  }
  const around = (ids: readonly string[], fallbackRoom: number, name: string) => {
    const area = boundsOf(ids.map((id) => places.at.get(id)).filter(isRect));
    if (area === undefined) {
      throw new Error(`No ${name} in the video at that moment`);
    }
    return frameAround(area, aspect, room ?? fallbackRoom);
  };
  let result = frame;
  if (changes.photo !== undefined) {
    const place = places.at.get(numbered(places.photos, changes.photo, 'photo'));
    if (place === undefined) {
      throw new Error(`Photo ${changes.photo} is not in the video at that moment`);
    }
    result =
      room === undefined ? frameFilledBy(place, aspect, align) : frameAround(place, aspect, room);
  } else if (changes.photos !== undefined) {
    result = around(photoIds(places, changes.photos), 0.04, 'such photos');
  } else if (changes.title === true) {
    result = around(places.texts, 0.12, 'title');
  } else if (changes.all === true) {
    result = around([...places.photos, ...places.texts], 0.04, 'photos');
  } else if (changes.frame !== undefined) {
    const [x, y, width, height] = Array.isArray(changes.frame) ? changes.frame : [];
    result = frameInShape(
      {
        x: numberOf(x, 'frame x', -1e6, 1e6),
        y: numberOf(y, 'frame y', -1e6, 1e6),
        width: numberOf(width, 'frame width', 1, 1e6),
        height: numberOf(height, 'frame height', 1, 1e6),
      },
      aspect,
    );
  }
  if (changes.zoom !== undefined) {
    const zoom = numberOf(changes.zoom, 'zoom', 0.1, 20);
    const width = result.width / zoom;
    const height = result.height / zoom;
    result = {
      x: result.x + (result.width - width) / 2,
      y: result.y + (result.height - height) / 2,
      width,
      height,
    };
  }
  if (changes.move !== undefined) {
    const [dx, dy] = Array.isArray(changes.move) ? changes.move : [];
    result = {
      ...result,
      x: result.x + numberOf(dx ?? 0, 'move x', -20, 20) * result.width,
      y: result.y + numberOf(dy ?? 0, 'move y', -20, 20) * result.height,
    };
  }
  return result;
}

/** The changes of a motion, checked; its photos as ids */
export function motionChanges(changes: MotionChanges, places: Places): Partial<Omit<Motion, 'id'>> {
  const { kind } = changes;
  if (kind !== undefined && !isMotionKind(kind)) {
    throw new Error(`No such motion: ${kind}`);
  }
  const optional = (value: unknown, name: string, min: number, max: number) =>
    value !== undefined ? numberOf(value, name, min, max) : undefined;
  return withoutUndefined({
    kind,
    targets: changes.photos !== undefined ? photoIds(places, changes.photos) : undefined,
    start: optional(changes.start, 'start', 0, 3600),
    length: optional(changes.length, 'length', 0.1, 3600),
    strength: optional(changes.strength, 'strength', 0, 3),
    speed: optional(changes.speed, 'speed', 0.1, 5),
    stagger: optional(changes.stagger, 'stagger', 0, 2),
  });
}

/** Photo numbers, short: "all" when they are every photo */
export function photoNumbers(places: Places, ids: readonly string[]): number[] | 'all' {
  const numbers = ids.map((id) => places.photos.indexOf(id) + 1).filter((n) => n > 0);
  return numbers.length === places.photos.length ? 'all' : numbers;
}

/** Whether the middle of `rect` is inside `frame`: a photo a shot shows */
export function isMiddleIn(rect: Rect, frame: Rect): boolean {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
}

const isRect = (rect: Rect | undefined): rect is Rect => rect !== undefined;

const ALIGNS = ['start', 'middle', 'end'] as const;
const isAlign = (value: string): value is (typeof ALIGNS)[number] =>
  (ALIGNS as readonly string[]).includes(value);

function withoutUndefined<T extends object>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

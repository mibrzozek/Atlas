/**
 * The Director's edits of a video, in the page (development only, see `index.ts`): what a command's
 * changes of a shot or a motion mean, checked before anything is changed. Photos, shots, layouts and
 * motions are numbered from 1, in the order `timeline` lists them.
 */
import {
  ARRIVALS,
  arrivalTimeOf,
  CameraStop,
  EASINGS,
  frameAround,
  frameFilledBy,
  frameInShape,
  startsOf,
  STAYS,
} from 'common/video';
import { clamp } from 'common/core';
import { isMotionKind, Motion } from 'common/video-motion';
import { boundsOf, overlaps, Point, Rect } from 'common/workspace';

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
  /** Where the subject of a photo is on the workspace at that moment, for the photos that have one in view */
  subjects?: ReadonlyMap<string, Point>;
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
  // A photo framed on its subject: the zoom then keeps the subject where it is in the frame
  let pivot: { area: Rect; subject: Point } | undefined;
  if (changes.photo !== undefined) {
    const id = numbered(places.photos, changes.photo, 'photo');
    const place = places.at.get(id);
    if (place === undefined) {
      throw new Error(`Photo ${changes.photo} is not in the video at that moment`);
    }
    const subject =
      room === undefined && changes.align === undefined ? places.subjects?.get(id) : undefined;
    if (subject !== undefined) {
      pivot = { area: place, subject };
      result = frameOnSubject(place, aspect, subject);
    } else {
      result =
        room === undefined ? frameFilledBy(place, aspect, align) : frameAround(place, aspect, room);
    }
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
    // Around the subject or the middle of the frame: what is there keeps its place in the frame
    const centre = pivot?.subject ?? {
      x: result.x + result.width / 2,
      y: result.y + result.height / 2,
    };
    result = {
      x: centre.x - ((centre.x - result.x) / result.width) * width,
      y: centre.y - ((centre.y - result.y) / result.height) * height,
      width,
      height,
    };
    if (pivot !== undefined && zoom >= 1) {
      result = keptIn(result, pivot.area);
    }
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
  return isPointIn({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, frame);
}

/** Whether a point is inside a frame, its edges included */
export function isPointIn(point: Point, frame: Rect): boolean {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
}

/**
 * A frame filled by `area` (as `frameFilledBy`), moved so that its middle is as near `subject` as `area` allows:
 * it stays on the photo
 */
export function frameOnSubject(area: Rect, aspect: number, subject: Point): Rect {
  return keptIn(frameFilledBy(area, aspect), area, subject);
}

/** The frame moved, not resized, so that its middle (or `point`) is as near as `area` allows: a frame stays on it */
function keptIn(frame: Rect, area: Rect, point?: Point): Rect {
  const at = point ?? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  return {
    ...frame,
    x: centreWithin(at.x, area.x, area.width, frame.width) - frame.width / 2,
    y: centreWithin(at.y, area.y, area.height, frame.height) - frame.height / 2,
  };
}

/** The nearest middle to `point` where a frame of `size` stays over the side of `length` that starts at `start` */
function centreWithin(point: number, start: number, length: number, size: number): number {
  const a = start + size / 2;
  const b = start + length - size / 2;
  return clamp(point, Math.min(a, b), Math.max(a, b));
}

/** A moment a `cuts` sheet shows: its time, and what it is: `start`, `end` or the cut `3|4` */
export interface CutMoment {
  time: number;
  label: string;
}

/** Fifteen cuts take 30 moments: with the first and the last frame, 32 on a sheet */
const CUTS_PER_SHEET = 15;

/**
 * The moments a `cuts` sheet shows, from shot `from` (numbered from 1) on: the first frame (from shot 1), then
 * for each cut the last moment of the shot before and the moment the shot after has arrived, then the last
 * frame of the video once the cuts reach the end
 */
export function cutMoments(
  camera: readonly CameraStop[],
  fps: number,
  length: number,
  from: number,
): CutMoment[] {
  const frame = 1 / fps;
  const starts = startsOf(camera);
  const lastOf = (i: number) => starts[i] + Math.max(0, camera[i].length - frame);
  const arrivalOf = (i: number) =>
    starts[i] + Math.max(0, Math.min(arrivalTimeOf(camera[i]), camera[i].length - frame));
  // Shot numbers: the cut after shot n is between camera[n - 1] and camera[n]
  const lastCut = Math.min(camera.length - 1, from + CUTS_PER_SHEET - 1);
  const moments: CutMoment[] = [];
  if (from === 1) {
    moments.push({ time: 0, label: 'start' });
  }
  for (let n = from; n <= lastCut; n++) {
    const label = `${n}|${n + 1}`;
    moments.push({ time: lastOf(n - 1), label }, { time: arrivalOf(n), label });
  }
  if (lastCut >= camera.length - 1) {
    moments.push({ time: Math.max(0, length - frame), label: 'end' });
  }
  return moments;
}

/** Whether a text is cut off by a shot's frame: it reaches into the frame, and is not all in it */
export function isTextCutOff(text: Rect, frame: Rect): boolean {
  const inside =
    text.x >= frame.x &&
    text.x + text.width <= frame.x + frame.width &&
    text.y >= frame.y &&
    text.y + text.height <= frame.y + frame.height;
  return overlaps(text, frame) && !inside;
}

/** What the warnings of `timelineWarnings` need to know of a shot */
export interface ShotFacts {
  n: number;
  length: number;
  /** The photo numbers whose middle is in the shot's frame at its middle */
  shows: number[];
  /** Whether the middle of a text is in the frame at the middle of the shot */
  showsText: boolean;
  /** Whether a text is cut off by the frame, at the middle of the shot or when the shot has arrived */
  textsCutOff: boolean;
  /** Whether the subject of the one photo a shot shows lies outside its frame, at the middle of the shot */
  subjectOutside: boolean;
  /** Whether this shot is a short invisible relay bridge (cut + linear pull-out) */
  isBridge?: boolean;
}

/** A shot shorter than this many seconds is quick; more than `QUICK_RUN` of them in a row hold nothing */
const QUICK_SHOT = 1.2;
const QUICK_RUN = 4;

/**
 * The weak spots of a video's timeline, a short sentence each, starting with the shot's number: a shot
 * shorter than a beat (`beat`, when there is music), one repeating the photo that was alone in an earlier
 * shot, a text cut off, a first shot showing nothing, and a run of quick shots
 */
export function timelineWarnings(shots: readonly ShotFacts[], beat?: number): string[] {
  const warnings: string[] = [];
  // Photo number -> the first shot where it is the only photo
  const aloneIn = new Map<number, number>();
  shots.forEach((shot, i) => {
    const { n, length, isBridge } = shot;
    if (!isBridge && beat !== undefined && length < beat) {
      warnings.push(
        `Shot ${n}: shorter than one beat (${length.toFixed(2)} s < ${beat.toFixed(2)} s)`,
      );
    }
    if (shot.shows.length === 1) {
      const [photo] = shot.shows;
      const first = aloneIn.get(photo);
      if (first === undefined) {
        aloneIn.set(photo, n);
      } else {
        warnings.push(`Shot ${n}: repeats photo ${photo} of shot ${first}`);
      }
    }
    if (shot.shows.length === 1 && shot.subjectOutside) {
      warnings.push(`Shot ${n}: photo ${shot.shows[0]}'s subject is outside the frame`);
    }
    if (i === 0 && shot.shows.length === 0 && !shot.showsText) {
      warnings.push(`Shot ${n}: opens on nothing`);
    }
    if (shot.textsCutOff) {
      warnings.push(`Shot ${n}: a title or text is cut off by its frame`);
    }
    // A run is counted from its first shot only (relay bridges do not count as quick cuts)
    const isQuick = (s: ShotFacts) => !s.isBridge && s.length < QUICK_SHOT;
    if (isQuick(shot) && (i === 0 || !isQuick(shots[i - 1]))) {
      let last = i;
      while (last + 1 < shots.length && isQuick(shots[last + 1])) {
        last++;
      }
      if (last - i + 1 > QUICK_RUN) {
        warnings.push(`Shot ${n}: no shot holds from shot ${n} to ${shots[last].n}`);
      }
    }
  });
  return warnings;
}

/** A pair of timestamps immediately before and at a cut or loop seam, to test pixel continuity */
export interface SeamPair {
  label: string;
  before: number;
  after: number;
}

/** Tiny offset before a cut instant so `before` samples `endFrame(prev)` and `after` samples `startFrame(next)` */
const SEAM_EPSILON = 1e-4;
/** Channel-level RMSE threshold (0..255) below which two frames are considered visually seamless */
export const SEAMLESS_RMSE_THRESHOLD = 6;

/** Whether a camera stop is a short invisible relay bridge (cut + linear pull-out) */
export const isBridgeShot = (stop: CameraStop): boolean =>
  stop.arrival === 'cut' &&
  stop.stay === 'pull-out' &&
  stop.easing === 'linear' &&
  stop.length <= 0.16;

/**
 * Every `cut` boundary in the timeline (after shot 1), plus `end|start` when `includeLoop` is true.
 */
export function seamPairs(
  camera: readonly CameraStop[],
  length: number,
  includeLoop: boolean,
): SeamPair[] {
  const starts = startsOf(camera);
  const pairs: SeamPair[] = [];
  for (let i = 1; i < camera.length; i++) {
    if (camera[i].arrival === 'cut') {
      const at = starts[i];
      pairs.push({
        label: `${i}|${i + 1}`,
        before: Math.max(0, at - SEAM_EPSILON),
        after: at,
      });
    }
  }
  if (includeLoop && camera.length > 0 && length > 0) {
    pairs.push({
      label: 'end|start',
      before: Math.max(0, length - SEAM_EPSILON),
      after: 0,
    });
  }
  return pairs;
}

/** RGB channel RMSE (0..255) and max single-channel delta between two equal-sized RGBA buffers */
export function pixelDiff(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
): { rmse: number; maxDelta: number; seamless: boolean } {
  if (a.length !== b.length || a.length === 0) {
    throw new Error('Buffers must have equal non-zero length');
  }
  let sumSq = 0;
  let maxDelta = 0;
  let channels = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sumSq += d * d;
      if (d > maxDelta) {
        maxDelta = d;
      }
      channels++;
    }
  }
  const rmse = Math.round(Math.sqrt(sumSq / channels) * 100) / 100;
  return { rmse, maxDelta, seamless: rmse <= SEAMLESS_RMSE_THRESHOLD };
}

/** A single step inside a `batch` call */
export interface BatchStep {
  method: string;
  args: unknown[];
}

/** Commands whose file paths are checked by the main process, or that cannot nest inside `batch` */
const NON_BATCH_COMMANDS = new Set(['batch', 'music', 'sound', 'save']);
const MAX_BATCH_STEPS = 500;

/** Validates a `batch` list of either `{ method, args? }` objects or `[method, ...args]` tuples */
export function parseBatchSteps(raw: unknown): BatchStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('batch expects a non-empty list of steps');
  }
  if (raw.length > MAX_BATCH_STEPS) {
    throw new Error(`batch accepts at most ${MAX_BATCH_STEPS} steps`);
  }
  return raw.map((entry, i) => {
    let method: unknown;
    let args: unknown[];
    if (Array.isArray(entry)) {
      [method, ...args] = entry;
    } else if (entry !== null && typeof entry === 'object') {
      const obj = entry as { method?: unknown; args?: unknown };
      method = obj.method;
      args = obj.args === undefined ? [] : Array.isArray(obj.args) ? obj.args : [obj.args];
    } else {
      throw new Error(`Step ${i + 1}: expected [method, ...args] or { method, args }`);
    }
    if (typeof method !== 'string' || method.length === 0) {
      throw new Error(`Step ${i + 1}: missing command name`);
    }
    if (NON_BATCH_COMMANDS.has(method)) {
      throw new Error(`Step ${i + 1}: ${method} must be called directly, not inside batch`);
    }
    return { method, args };
  });
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

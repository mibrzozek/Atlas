/**
 * Motions: behaviours put on objects of a video for a stretch of time, as a filter is put on a photo.
 * Entrances bring an object in at the start of the stretch (it is not seen before), exits take it out at
 * the end (it is not seen after), and the others move it all through (jiggle, float...). Each has a
 * strength and a speed; several objects can be given a stagger, so they move one after another, in the
 * order they were chosen. What they do to an object at a time is `motionAt`.
 */

export type MotionKind =
  | 'pop-in'
  | 'drop-in'
  | 'slide-in'
  | 'fade-in'
  | 'jiggle'
  | 'float'
  | 'wave'
  | 'breathe'
  | 'pulse'
  | 'shake'
  | 'spin'
  | 'hide'
  | 'pop-out'
  | 'fly-out'
  | 'fade-out';

export type MotionGroup = 'enter' | 'during' | 'exit';

export const MOTION_KINDS: readonly {
  kind: MotionKind;
  name: string;
  group: MotionGroup;
  detail: string;
}[] = [
  { kind: 'pop-in', name: 'Pop in', group: 'enter', detail: 'Grows in with a little bounce' },
  { kind: 'drop-in', name: 'Drop in', group: 'enter', detail: 'Falls into place' },
  { kind: 'slide-in', name: 'Slide in', group: 'enter', detail: 'Slides in from the side' },
  { kind: 'fade-in', name: 'Fade in', group: 'enter', detail: 'Appears softly' },
  { kind: 'jiggle', name: 'Jiggle', group: 'during', detail: 'Wobbles from side to side' },
  { kind: 'float', name: 'Float', group: 'during', detail: 'Bobs gently up and down' },
  {
    kind: 'wave',
    name: 'Wave',
    group: 'during',
    detail: 'A swell passes under them, one after another, and they bob',
  },
  { kind: 'breathe', name: 'Breathe', group: 'during', detail: 'Grows and shrinks slowly' },
  {
    kind: 'pulse',
    name: 'Pulse on the beat',
    group: 'during',
    detail: 'Jumps a little on every beat',
  },
  { kind: 'shake', name: 'Shake', group: 'during', detail: 'Trembles' },
  { kind: 'spin', name: 'Spin', group: 'during', detail: 'Turns round' },
  { kind: 'hide', name: 'Hide', group: 'during', detail: 'Out of sight for a while' },
  { kind: 'pop-out', name: 'Pop out', group: 'exit', detail: 'Shrinks away' },
  { kind: 'fly-out', name: 'Fly out', group: 'exit', detail: 'Flies off upwards' },
  { kind: 'fade-out', name: 'Fade out', group: 'exit', detail: 'Disappears softly' },
];

export const isMotionKind = (kind: unknown): kind is MotionKind =>
  MOTION_KINDS.some((m) => m.kind === kind);

export const groupOf = (kind: MotionKind): MotionGroup =>
  MOTION_KINDS.find((m) => m.kind === kind)!.group;

export interface Motion {
  id: string;
  kind: MotionKind;
  /** The objects it moves, in the order they were chosen (the order of the stagger) */
  targets: string[];
  /** When it begins, and how long it lasts, in seconds of the video */
  start: number;
  length: number;
  /** How much: 1 is as designed, 0 nothing, 2 twice as much */
  strength: number;
  /** How fast: 1 is as designed */
  speed: number;
  /** How much later each next object begins, in seconds */
  stagger: number;
}

/** What motions do to an object: moved by a part of its size, scaled and turned around its middle, faded */
export interface MotionTransform {
  /** Moved across and down, in widths and heights of the object */
  dx: number;
  dy: number;
  scale: number;
  /** Turned, in degrees */
  rotation: number;
  /** How much it is seen: 0 to 1 */
  opacity: number;
}

export const STILL: MotionTransform = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };

/** How long an entrance or an exit takes, at speed 1 */
const ENTRANCE_TIME = 0.6;
/** How long a motion that lasts takes to come and to go: it never starts or stops with a jolt */
const RAMP_TIME = 0.15;
/** When the crest of a wave is under an object, after its part of the wave began, at speed 1 */
const WAVE_CREST = 0.6;
/** How wide a wave's crest is, in seconds */
const WAVE_WIDTH = 0.35;
/** How long an object is moved by one wave: lifted, then bobbing until it rests */
const WAVE_TIME = 4;
/** How long the crest takes to cross everything a wave moves */
const WAVE_CROSSING = 2.4;

/** When a wave's crest is under the middle one of what it moves, in seconds of the video */
export function crestOf(
  wave: Pick<Motion, 'start' | 'speed' | 'stagger'> & { targets: readonly string[] },
): number {
  return (
    wave.start +
    WAVE_CREST / Math.max(0.1, wave.speed) +
    (wave.stagger * (wave.targets.length - 1)) / 2
  );
}

/**
 * Waves through objects, `targets` in the order the crest reaches them: one a swell, its crest under the
 * middle one at that time (in seconds of the video)
 */
export function wavesAt(
  swells: readonly number[],
  targets: readonly string[],
  newId: () => string,
  strength = 1,
): Motion[] {
  const stagger = targets.length > 1 ? WAVE_CROSSING / (targets.length - 1) : 0;
  const toMiddle = crestOf({ start: 0, speed: 1, stagger, targets });
  return swells
    .filter((swell) => swell >= toMiddle)
    .map((swell) => ({
      id: newId(),
      kind: 'wave',
      targets: [...targets],
      start: swell - toMiddle,
      length: WAVE_CROSSING + WAVE_TIME,
      strength,
      speed: 1,
      stagger,
    }));
}

/**
 * What all the motions of an object do to it at a time, combined: moves added, scales and opacities
 * multiplied. `beats` are the beats of the music, in seconds of the video.
 */
export function motionAt(
  motions: readonly Motion[],
  id: string,
  time: number,
  beats: readonly number[] = [],
): MotionTransform {
  const result = { ...STILL };
  for (const motion of motions) {
    const place = motion.targets.indexOf(id);
    if (place === -1) {
      continue;
    }
    const start = motion.start + place * motion.stagger;
    const end = motion.start + motion.length;
    const one = motionOf(motion, time - start, Math.max(0, end - start), time, beats);
    result.dx += one.dx;
    result.dy += one.dy;
    result.scale *= one.scale;
    result.rotation += one.rotation;
    result.opacity *= one.opacity;
  }
  return result;
}

/** One motion, `into` seconds after it began for this object, lasting `length` for it */
function motionOf(
  motion: Motion,
  into: number,
  length: number,
  time: number,
  beats: readonly number[],
): MotionTransform {
  const { kind, strength } = motion;
  const speed = Math.max(0.1, motion.speed);
  const group = groupOf(kind);
  const duration = Math.min(ENTRANCE_TIME / speed, Math.max(length, 1e-6));

  if (group === 'enter') {
    if (into < 0) {
      return { ...STILL, opacity: 0 };
    }
    const t = Math.min(1, into / duration);
    switch (kind) {
      case 'pop-in':
        return {
          ...STILL,
          scale: lerp(1 - 0.85 * strength, 1, backOut(t)),
          opacity: Math.min(1, t * 3),
        };
      case 'drop-in':
        return { ...STILL, dy: -1.2 * strength * (1 - bounceOut(t)), opacity: Math.min(1, t * 4) };
      case 'slide-in':
        return { ...STILL, dx: -1.2 * strength * (1 - cubicOut(t)), opacity: Math.min(1, t * 2) };
      default:
        return { ...STILL, opacity: cubicOut(t) };
    }
  }

  if (group === 'exit') {
    const left = length - into;
    if (into < 0 || left > duration) {
      return STILL;
    }
    if (left <= 0) {
      return { ...STILL, opacity: 0 };
    }
    const t = 1 - left / duration;
    switch (kind) {
      case 'pop-out':
        return {
          ...STILL,
          scale: lerp(1, 1 - 0.9 * strength, cubicIn(t)),
          opacity: 1 - cubicIn(t),
        };
      case 'fly-out':
        return { ...STILL, dy: -2 * strength * cubicIn(t), opacity: 1 - t * t };
      default:
        return { ...STILL, opacity: 1 - cubicOut(t) };
    }
  }

  // Lasting motions, eased in and out at their ends
  if (into < 0 || into > length) {
    return STILL;
  }
  const ramp = Math.min(1, into / RAMP_TIME, (length - into) / RAMP_TIME);
  const s = strength * ramp;
  const phase = into * speed;
  switch (kind) {
    case 'jiggle':
      return {
        ...STILL,
        rotation: 4 * s * Math.sin(phase * Math.PI * 2 * 3),
        scale: 1 + 0.015 * s * Math.sin(phase * Math.PI * 2 * 6),
      };
    case 'float':
      return { ...STILL, dy: 0.04 * s * Math.sin(phase * Math.PI * 2 * 0.5) };
    case 'wave': {
      // Lifted and tipped forwards as the crest passes under it, into the trough behind it, then bobbing
      // as the water settles
      const t = phase - WAVE_CREST;
      const crest = Math.exp(-((t / WAVE_WIDTH) ** 2));
      const bob = t > 0 ? -Math.exp(-t / 1.4) * Math.sin((t * Math.PI * 2) / 1.3) * 0.3 : 0;
      return {
        ...STILL,
        dy: -0.12 * s * (crest + bob),
        rotation: -6 * s * (t / WAVE_WIDTH) * crest,
      };
    }
    case 'breathe':
      return { ...STILL, scale: 1 + 0.04 * s * Math.sin(phase * Math.PI * 2 * 0.35) };
    case 'shake':
      return {
        ...STILL,
        dx: 0.015 * s * (Math.sin(phase * 71) * 0.6 + Math.sin(phase * 113) * 0.4),
        dy: 0.015 * s * (Math.sin(phase * 89 + 1) * 0.6 + Math.sin(phase * 131 + 2) * 0.4),
      };
    case 'spin':
      return { ...STILL, rotation: 360 * phase * 0.25 * Math.min(1, s) };
    case 'hide':
      return { ...STILL, opacity: 1 - Math.min(1, s) };
    case 'pulse': {
      // A jump on the last beat that has sounded, fading before the next; without music, twice a second
      const last = lastBeat(time, beats) ?? Math.floor(time * 2) / 2;
      const since = time - last;
      return { ...STILL, scale: 1 + 0.08 * s * Math.exp(-since * 9 * speed) };
    }
    default:
      return STILL;
  }
}

function lastBeat(time: number, beats: readonly number[]): number | undefined {
  let last: number | undefined;
  for (const beat of beats) {
    if (beat > time) {
      break;
    }
    last = beat;
  }
  return last;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cubicOut = (t: number) => 1 - Math.pow(1 - t, 3);
const cubicIn = (t: number) => t * t * t;

/** Past the end a little, and back: the bounce of a pop */
function backOut(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/** A ball dropped on the floor */
function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) {
    return n * t * t;
  }
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

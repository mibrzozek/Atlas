/**
 * Videos of a workspace (docs/workspace-video-plan.md): the maths of them. A video is made of lanes on one
 * timeline:
 * - the camera: stops in a row, each a frame on the workspace, how the camera arrives there (glide, whip,
 *   cut, scroll) and what it does while there (still, push in, pull out, drift);
 * - the layout (if any): arrangements in a row, the objects gliding from one to the next; without any,
 *   everything stays where it is on the workspace;
 * - motion: behaviours of chosen objects over a stretch of time (pop in, jiggle, float...), see
 *   `video-motion.ts`;
 * - music: one song, whose beats the edit snaps to (`beats.ts`), and sound effects put at times of it.
 * What a frame of the video shows at a time is `stateAt`: the preview and the saved video both draw from
 * it, so they cannot differ.
 */

import { Crop, cropFromRow, cropOf } from './crop';
import { isMotionKind, Motion, motionAt, MotionTransform } from './video-motion';
import type { Rect, Size, WorkspaceItem } from './workspace';

/** The shapes a video is made in, for where it will be shown */
export interface VideoFormat extends Size {
  name: string;
}

export const VIDEO_FORMATS: readonly VideoFormat[] = [
  { name: 'Reels, TikTok, Stories (9:16)', width: 1080, height: 1920 },
  { name: 'Feed (4:5)', width: 1080, height: 1350 },
  { name: 'Square (1:1)', width: 1080, height: 1080 },
  { name: 'Landscape (16:9)', width: 1920, height: 1080 },
];

export const FRAME_RATES = [30, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

/** How a move runs its course */
export type Easing = 'smooth' | 'gentle' | 'snappy' | 'linear';

export const EASINGS: readonly { easing: Easing; name: string }[] = [
  { easing: 'smooth', name: 'Smooth' },
  { easing: 'gentle', name: 'Gentle' },
  { easing: 'snappy', name: 'Snappy' },
  { easing: 'linear', name: 'Even' },
];

/** Where an object is, and the part of its photo it shows */
export interface Pose extends Rect {
  crop?: Crop;
}

// The lanes

/** Something on a lane whose blocks follow one another from the start: the camera, the layout */
export interface InRow {
  id: string;
  /** How long it lasts on the timeline, in seconds */
  length: number;
}

/** How the camera gets to a stop from the one before */
export type Arrival = 'glide' | 'whip' | 'cut' | 'scroll';
/** What the camera does while it is at a stop */
export type Stay = 'still' | 'push-in' | 'pull-out' | 'drift';

export const ARRIVALS: readonly { arrival: Arrival; name: string; detail: string }[] = [
  { arrival: 'glide', name: 'Glide', detail: 'Pans and zooms there smoothly' },
  { arrival: 'whip', name: 'Whip', detail: 'A fast swish' },
  { arrival: 'cut', name: 'Cut', detail: 'Jumps there at once, best on a beat' },
  { arrival: 'scroll', name: 'Scroll', detail: 'Slides there evenly over the whole stop' },
];

export const STAYS: readonly { stay: Stay; name: string; detail: string }[] = [
  { stay: 'still', name: 'Still', detail: 'Rests' },
  { stay: 'push-in', name: 'Push in', detail: 'Slowly closer' },
  { stay: 'pull-out', name: 'Pull out', detail: 'Slowly further away' },
  { stay: 'drift', name: 'Drift', detail: 'Floats gently, as if held by hand' },
];

export interface CameraStop extends InRow {
  /** What the camera shows there, on the workspace: of the video's shape */
  frame: Rect;
  arrival: Arrival;
  /** How long a glide or a whip takes, in seconds (a cut takes none, a scroll the whole stop) */
  arrivalTime: number;
  stay: Stay;
  easing: Easing;
}

export interface LayoutBlock extends InRow {
  /** Where the objects are; an object that is not here is not seen */
  poses: Record<string, Pose>;
  /** How long the objects take to glide here from the arrangement before, in seconds */
  transition: number;
  easing: Easing;
}

/** How loud a song is when it is added: half, so that it does not drown out the room it is played in */
export const MUSIC_VOLUME = 0.5;

/** A song under the video: where it begins, and its beats, found once when it was added */
export interface MusicTrack {
  /** The audio file, outside the library: it is only read */
  path: string;
  name: string;
  /** When the song begins in the video, in seconds */
  start: number;
  /** How much of the beginning of the song is left out, in seconds */
  trim: number;
  /** How long the song is, in seconds */
  duration: number;
  /** 0 to 1 */
  volume: number;
  /** Beats per minute, as found */
  bpm: number;
  /** The beats, in seconds of the song */
  beats: number[];
  /** When it swells (`findSwells`), in seconds of the song; songs added before this have none */
  swells?: number[];
}

/** A sound effect under the video (a file in audio/sfx/): it starts at `at` and plays `duration` seconds */
export interface SoundEffect {
  id: string;
  /** The audio file, outside the library: it is only read */
  path: string;
  name: string;
  /** When it starts in the video, in seconds */
  at: number;
  /** 0 to MAX_SOUND_VOLUME */
  volume: number;
  /** How long the file is, in seconds */
  duration: number;
}

/** How loud a sound effect is when it is added: louder than a song, which is added at MUSIC_VOLUME */
export const SOUND_VOLUME = 0.8;
export const MAX_SOUND_VOLUME = 1.5;

export interface VideoProject extends Size {
  fps: FrameRate;
  /** What is behind everything, where nothing is: any CSS colour */
  background: string;
  /**
   * The frame of the video before it has camera stops (drawn dotted, "Video"): where the camera is
   * without them, and the first stop's shot when one is added. Made in what was in view, reshaped by a
   * change of format
   */
  frame: Rect;
  camera: CameraStop[];
  layouts: LayoutBlock[];
  motions: Motion[];
  music?: MusicTrack;
  /** Sound effects under the video, in the order they were added (`soundsByTime` puts them in time) */
  sounds?: SoundEffect[];
  /**
   * Where the video ends, in seconds: the end marker, once it is put somewhere by hand. Until then it
   * follows the end of the camera (`naturalEnd`)
   */
  end?: number;
}

/** How long a new stop or layout lasts; and how long a glide takes */
export const DEFAULT_BLOCK_LENGTH = 4;
export const DEFAULT_ARRIVAL_TIME = 1.2;
/** The shortest a block can be made by dragging its edge */
export const MIN_BLOCK_LENGTH = 0.1;
/** How much of the timeline is shown at first, in seconds; it zooms in and out */
export const TIMELINE_SECONDS = 60;
/** How much closer a push in ends (or a pull out begins): the frame this much smaller */
const PUSH = 0.85;
/** How long a whip takes at most */
const WHIP_TIME = 0.35;

/**
 * The most 16 by 16 blocks a frame can have: what H.264 at level 4.2 allows (1920 × 1080 and 1080 × 1920
 * fit), the profile this Electron encodes
 */
const MAX_BLOCKS = 8192;
const MIN_SIDE = 16;

/** A size a video can be made in: both sides even, at least 16, and within what the encoder takes */
export function videoSize(width: number, height: number): Size {
  let w = Math.max(MIN_SIDE, Math.round(width) || MIN_SIDE);
  let h = Math.max(MIN_SIDE, Math.round(height) || MIN_SIDE);
  const blocks = Math.ceil(w / 16) * Math.ceil(h / 16);
  if (blocks > MAX_BLOCKS) {
    const scale = Math.sqrt(MAX_BLOCKS / blocks);
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
    // Rounding up to whole blocks may still be one row too many
    while (Math.ceil(w / 16) * Math.ceil(h / 16) > MAX_BLOCKS) {
      w = Math.floor(w * 0.99);
      h = Math.floor(h * 0.99);
    }
  }
  const even = (n: number) => Math.max(MIN_SIDE, n - (n % 2));
  return { width: even(w), height: even(h) };
}

/** A video with nothing on its lanes, its frame as large as fits in `area` (what is in view) */
export function newVideo(area: Rect, format: Size = VIDEO_FORMATS[0]): VideoProject {
  const size = videoSize(format.width, format.height);
  return {
    ...size,
    fps: 30,
    background: '#000000',
    frame: frameIn(area, size.width / size.height),
    camera: [],
    layouts: [],
    motions: [],
  };
}

/** The video in another size: its frames in the new shape, around their middles */
export function resizeVideo(video: VideoProject, format: Size): VideoProject {
  const size = videoSize(format.width, format.height);
  const aspect = size.width / size.height;
  return {
    ...video,
    ...size,
    frame: frameInShape(video.frame, aspect),
    camera: video.camera.map((stop) => ({ ...stop, frame: frameInShape(stop.frame, aspect) })),
  };
}

/** The room between a shot and the next one made beside it, in widths of the shot */
const SHOT_GAP = 0.08;

/**
 * Where a new camera stop's shot goes: just to the right of the stop `afterId` (or the last), as large as
 * it, to be moved to the next thing to show; the first one where the video's frame is
 */
export function nextShotFrame(video: VideoProject, afterId?: string): Rect {
  const before = video.camera.find((stop) => stop.id === afterId) ?? video.camera.at(-1);
  if (before === undefined) {
    return video.frame;
  }
  const { frame } = before;
  return { ...frame, x: frame.x + frame.width * (1 + SHOT_GAP) };
}

/** The camera stop before the one of `id`, where the camera comes from: what its shot is lined up with */
export function shotBefore(video: VideoProject, id: string | undefined): CameraStop | undefined {
  const index = video.camera.findIndex((stop) => stop.id === id);
  return index > 0 ? video.camera[index - 1] : undefined;
}

/** The music files a video can take: what the file dialog shows, and the songs of `audio/` */
export const MUSIC_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm'];

/** What a video is saved at: its own size, or small enough to be sent to a phone */
export type VideoSize = 'full' | 'phone';

/** The longest side of a video saved at phone size, in pixels (720 × 1280 for 9:16) */
const PHONE_SIDE = 1280;
/**
 * How large a video saved at phone size may become at most, in bytes: the phone link of the Claude app
 * takes up to 30 MB, and the file has some room around the picture and the sound
 */
const PHONE_BUDGET = 26 * 1024 * 1024;
/** The bitrate of the music in a saved video, in bits a second (the AAC encoder's) */
export const MUSIC_BITRATE = 192_000;

/** The size the frames of a saved video are drawn at: the video's own, or at phone size its shape kept */
export function outputSize(video: Size, size: VideoSize = 'full'): Size {
  const scale =
    size === 'phone' ? Math.min(1, PHONE_SIDE / Math.max(video.width, video.height)) : 1;
  return videoSize(video.width * scale, video.height * scale);
}

/**
 * The bitrate of the picture of a saved video, in bits a second: enough for a clean picture of photos
 * (about 12 Mbit/s at 1080 × 1920, 30 frames a second); at phone size no more than keeps the whole file,
 * the music included, within the budget for its length. Never under 0.5 Mbit/s, below which photos smear:
 * a phone video of over about 6 minutes is then larger than the budget. The encoder aims at the bitrate,
 * it is not held to it
 */
export function videoBitrate(output: Size, fps: number, length: number, size: VideoSize): number {
  const clean = Math.round(output.width * output.height * fps * 0.2);
  if (size === 'full') {
    return clean;
  }
  const budget = (PHONE_BUDGET * 8) / Math.max(1, length) - MUSIC_BITRATE;
  return Math.max(500_000, Math.min(clean, Math.round(budget)));
}

/** The largest frame of `aspect` in the middle of `area` */
export function frameIn(area: Rect, aspect: number): Rect {
  const width = Math.min(area.width, area.height * aspect);
  const height = width / aspect;
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  };
}

/** The smallest frame of `aspect` that shows all of `area` with room around it (`margin`, of its size) */
export function frameAround(area: Rect, aspect: number, margin = 0.08): Rect {
  const width = Math.max(area.width, area.height * aspect) * (1 + 2 * margin);
  const height = width / aspect;
  return {
    x: area.x + area.width / 2 - width / 2,
    y: area.y + area.height / 2 - height / 2,
    width,
    height,
  };
}

/**
 * A frame of `aspect` filled with `area`: cut to the frame's shape, a little room at its edges. In its
 * middle, or against its start (left, or top when it is taller than the frame) or end: from one to the
 * other the camera pans over all of it
 */
export function frameFilledBy(
  area: Rect,
  aspect: number,
  align: 'middle' | 'start' | 'end' = 'middle',
): Rect {
  const isWider = area.width / area.height > aspect;
  const height = isWider ? area.height * 1.03 : (area.width * 1.03) / aspect;
  const width = height * aspect;
  // The room at the short sides, kept at the long ones as well
  const room = isWider ? (height - area.height) / 2 : (width - area.width) / 2;
  const along = (start: number, length: number, size: number) =>
    align === 'start'
      ? start - room
      : align === 'end'
      ? start + length + room - size
      : start + length / 2 - size / 2;
  return {
    x: isWider ? along(area.x, area.width, width) : area.x + area.width / 2 - width / 2,
    y: isWider ? area.y + area.height / 2 - height / 2 : along(area.y, area.height, height),
    width,
    height,
  };
}

/** A frame in another shape, around the same middle and about as large */
export function frameInShape(frame: Rect, aspect: number): Rect {
  const width = Math.sqrt(frame.width * frame.height * aspect);
  const height = width / aspect;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

/** Where every object is now, for a layout. Images keep their crop as it shows, chosen or the middle */
export function posesOf(items: readonly WorkspaceItem[]): Record<string, Pose> {
  const poses: Record<string, Pose> = {};
  for (const item of items) {
    const { x, y, width, height } = item;
    poses[item.id] =
      item.kind === 'image' ? { x, y, width, height, crop: cropOf(item) } : { x, y, width, height };
  }
  return poses;
}

// Blocks in a row

/** When each block of a row begins, in seconds */
export function startsOf(blocks: readonly InRow[]): number[] {
  const starts: number[] = [];
  let time = 0;
  for (const block of blocks) {
    starts.push(time);
    time += block.length;
  }
  return starts;
}

/** When a row ends */
export const endOf = (blocks: readonly InRow[]): number =>
  blocks.reduce((sum, block) => sum + block.length, 0);

/** The block of a row that is on at a time (the last one past its end), or -1 when the row is empty */
export function blockAt(blocks: readonly InRow[], time: number): number {
  let index = blocks.length === 0 ? -1 : 0;
  startsOf(blocks).forEach((start, i) => {
    if (time >= start) {
      index = i;
    }
  });
  return index;
}

/** A block made to last `length` seconds, as when its edge is dragged; in tenths of a second */
export function withLength<T extends InRow>(blocks: readonly T[], id: string, length: number): T[] {
  const target = Math.max(MIN_BLOCK_LENGTH, Math.round(length * 100) / 100);
  return blocks.map((block) => (block.id === id ? { ...block, length: target } : block));
}

/** A block moved to `toIndex` in its row (counted without it), lasting as long as it did */
export function moveInRow<T extends InRow>(blocks: readonly T[], id: string, toIndex: number): T[] {
  const block = blocks.find((b) => b.id === id);
  if (block === undefined) {
    return [...blocks];
  }
  const others = blocks.filter((b) => b.id !== id);
  others.splice(Math.max(0, Math.min(others.length, toIndex)), 0, block);
  return others;
}

/**
 * Where the end marker is while it is not put anywhere by hand: at the end of the last camera stop, or
 * without a camera, where the last of the layouts and the motions ends
 */
export function naturalEnd(video: VideoProject): number {
  if (video.camera.length > 0) {
    return endOf(video.camera);
  }
  const motionsEnd = video.motions.reduce(
    (end, motion) => Math.max(end, motion.start + motion.length),
    0,
  );
  return Math.max(endOf(video.layouts), motionsEnd);
}

/** How long the video is, and so what is saved: up to its end marker */
export function videoLength(video: VideoProject): number {
  return video.end ?? naturalEnd(video);
}

/** The end marker put at a time (in hundredths of a second), or back on the end of the camera */
export function withEnd(video: VideoProject, end: number | undefined): VideoProject {
  return {
    ...video,
    end: end === undefined ? undefined : Math.max(MIN_BLOCK_LENGTH, Math.round(end * 100) / 100),
  };
}

/** How many frames the saved video has */
export function frameCount(video: VideoProject): number {
  return Math.max(1, Math.round(videoLength(video) * video.fps));
}

/**
 * The poses of a layout brought up to date with the workspace, while that layout is shown: what is in it,
 * and what is new (in no layout yet), where it is now. What is in other layouts but not this one stays out
 * of it, and what was taken off the workspace goes out of it.
 */
export function followLayout(
  video: VideoProject,
  layoutId: string,
  items: readonly WorkspaceItem[],
): VideoProject {
  const layout = video.layouts.find((l) => l.id === layoutId);
  if (layout === undefined) {
    return video;
  }
  const inALayout = new Set(video.layouts.flatMap((l) => Object.keys(l.poses)));
  const followed = items.filter((item) => item.id in layout.poses || !inALayout.has(item.id));
  const poses = posesOf(followed);
  return {
    ...video,
    layouts: video.layouts.map((l) => (l === layout ? { ...l, poses } : l)),
  };
}

// What a frame shows

/** An object as a frame of the video shows it: where (its layout), and how its motions change that */
export interface PosedObject extends Pose, MotionTransform {}

export interface VideoState {
  /** What the camera shows, on the workspace */
  frame: Rect;
  /** Every object that is seen, by id; undefined: none of the layout lane, everything where it is */
  objects: Map<string, PosedObject>;
}

/**
 * What a frame of the video shows at `time`. `items` are the objects on the workspace (where they are
 * when there is no layout), `beats` the beats of the music in seconds of the video (motions on the beat).
 */
export function stateAt(
  video: VideoProject,
  items: readonly WorkspaceItem[],
  time: number,
  beats: readonly number[] = videoBeats(video),
): VideoState {
  const poses = layoutAt(video, items, time);
  const objects = new Map<string, PosedObject>();
  // Motions in order: the place of each object among the targets of a motion staggers it
  for (const [id, pose] of poses) {
    objects.set(id, { ...pose, ...motionAt(video.motions, id, time, beats) });
    const object = objects.get(id)!;
    object.opacity *= pose.opacity;
  }
  return { frame: cameraAt(video, time), objects };
}

/** Where the camera is at a time: on the frame of the workspace when it has no stops */
export function cameraAt(video: VideoProject, time: number): Rect {
  const { camera } = video;
  const index = blockAt(camera, time);
  if (index === -1) {
    return video.frame;
  }
  const stop = camera[index];
  const into = Math.max(0, time - startsOf(camera)[index]);
  const from = index > 0 ? endFrame(camera[index - 1]) : startFrame(stop);
  const arriving = index === 0 ? 0 : arrivalTimeOf(stop);
  if (into < arriving) {
    const t = into / arriving;
    const eased =
      stop.arrival === 'scroll' ? t : ease(stop.arrival === 'whip' ? 'snappy' : stop.easing, t);
    return zoomBetween(from, startFrame(stop), eased);
  }
  const staying = Math.max(1e-6, stop.length - arriving);
  const t = Math.min(1, (into - arriving) / staying);
  switch (stop.stay) {
    case 'push-in':
    case 'pull-out':
      return zoomBetween(startFrame(stop), endFrame(stop), ease('gentle', t));
    case 'drift':
      return drift(stop.frame, time);
    default:
      return stop.frame;
  }
}

/**
 * The narrowest the camera's frame ever is, in units of the workspace: how close it comes. Its stops,
 * pushed in where they push; the frame of the workspace only when there are no stops (with stops, the
 * camera never shows it)
 */
export function closestFrameWidth(video: VideoProject): number {
  if (video.camera.length === 0) {
    return video.frame.width;
  }
  return Math.min(
    ...video.camera.map((stop) => stop.frame.width * (stop.stay === 'still' ? 1 : PUSH)),
  );
}

/** How long the camera takes to arrive at a stop: the part of it the timeline shows striped */
export function arrivalTimeOf(stop: CameraStop): number {
  switch (stop.arrival) {
    case 'cut':
      return 0;
    case 'scroll':
      return stop.length;
    case 'whip':
      return Math.min(WHIP_TIME, stop.arrivalTime, stop.length);
    default:
      return Math.min(stop.arrivalTime, stop.length);
  }
}

/** Where the camera is when a stop begins (a pull out begins closer) and when it ends (a push in ends closer) */
const startFrame = (stop: CameraStop): Rect =>
  stop.stay === 'pull-out' ? scaled(stop.frame, PUSH) : stop.frame;
const endFrame = (stop: CameraStop): Rect =>
  stop.stay === 'push-in' ? scaled(stop.frame, PUSH) : stop.frame;

function scaled(frame: Rect, factor: number): Rect {
  const width = frame.width * factor;
  const height = frame.height * factor;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

/** A frame floating gently around where it is: slow waves of different lengths, never repeating soon */
function drift(frame: Rect, time: number): Rect {
  const dx = Math.sin(time * 0.71) * 0.6 + Math.sin(time * 1.37 + 1) * 0.4;
  const dy = Math.sin(time * 0.53 + 2) * 0.6 + Math.sin(time * 1.11 + 3) * 0.4;
  const zoom = 1 + Math.sin(time * 0.37) * 0.01;
  const moved = scaled(frame, 0.97 * zoom);
  return {
    ...moved,
    x: moved.x + dx * frame.width * 0.012,
    y: moved.y + dy * frame.height * 0.012,
  };
}

/**
 * Where the objects are at a time: as on the workspace when the layout lane is empty; else at the
 * arrangement of the block that is on, gliding there from the one before for the first `transition`
 * seconds (an object in both moves; one only in the new fades in, one only in the old fades out)
 */
function layoutAt(
  video: VideoProject,
  items: readonly WorkspaceItem[],
  time: number,
): Map<string, Pose & { opacity: number }> {
  const poses = new Map<string, Pose & { opacity: number }>();
  const { layouts } = video;
  const index = blockAt(layouts, time);
  if (index === -1) {
    const current = posesOf(items);
    for (const item of items) {
      poses.set(item.id, { ...current[item.id], opacity: 1 });
    }
    return poses;
  }
  const layout = layouts[index];
  const into = time - startsOf(layouts)[index];
  const previous = layouts[index - 1];
  const transition = Math.min(layout.transition, layout.length);
  if (previous === undefined || into >= transition) {
    for (const [id, pose] of Object.entries(layout.poses)) {
      poses.set(id, { ...pose, opacity: 1 });
    }
    return poses;
  }
  const t = ease(layout.easing, Math.max(0, into / transition));
  for (const [id, a] of Object.entries(previous.poses)) {
    const b = layout.poses[id];
    poses.set(id, b === undefined ? { ...a, opacity: 1 - t } : { ...mix(a, b, t), opacity: 1 });
  }
  for (const [id, b] of Object.entries(layout.poses)) {
    if (previous.poses[id] === undefined) {
      poses.set(id, { ...b, opacity: t });
    }
  }
  return poses;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mix(a: Pose, b: Pose, t: number): Pose {
  const rect = {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
  };
  if (a.crop === undefined || b.crop === undefined) {
    return { ...rect, crop: b.crop ?? a.crop };
  }
  return {
    ...rect,
    crop: {
      x: lerp(a.crop.x, b.crop.x, t),
      y: lerp(a.crop.y, b.crop.y, t),
      width: lerp(a.crop.width, b.crop.width, t),
      height: lerp(a.crop.height, b.crop.height, t),
    },
  };
}

/**
 * Part of the way from one frame to another. Its size changes by the same factor in every equal step of
 * time, so a zoom looks even rather than fast at first
 */
function zoomBetween(a: Rect, b: Rect, t: number): Rect {
  const width = a.width * Math.pow(b.width / a.width, t);
  const height = a.height * Math.pow(b.height / a.height, t);
  const middleX = lerp(a.x + a.width / 2, b.x + b.width / 2, t);
  const middleY = lerp(a.y + a.height / 2, b.y + b.height / 2, t);
  return { x: middleX - width / 2, y: middleY - height / 2, width, height };
}

/** The curves of the easings, as CSS writes them: cubic-bezier(x1, y1, x2, y2) */
const CURVES: Record<Easing, [number, number, number, number]> = {
  smooth: [0.45, 0, 0.25, 1],
  gentle: [0.35, 0, 0.45, 1],
  snappy: [0.2, 0, 0, 1],
  linear: [0, 0, 1, 1],
};

/** How far along a move is (0 to 1) after `t` of its time (0 to 1) */
export function ease(easing: Easing, t: number): number {
  const time = Math.min(1, Math.max(0, t));
  const [x1, y1, x2, y2] = CURVES[easing];
  if (x1 === y1 && x2 === y2) {
    return time;
  }
  const at = (p1: number, p2: number, s: number) =>
    3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
  // The point of the curve whose x is the time: by halving, which always finds it
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (at(x1, x2, middle) < time) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return at(y1, y2, (low + high) / 2);
}

// The music

/** The beats of the music in seconds of the video: those the video can hear */
export function videoBeats(video: VideoProject): number[] {
  return inVideo(video, video.music?.beats ?? []);
}

/** The swells of the music (`findSwells`) in seconds of the video: those the video can hear */
export function videoSwells(video: VideoProject): number[] {
  return inVideo(video, video.music?.swells ?? []);
}

/** Times of the song in seconds of the video, those it leaves out left out */
function inVideo(video: VideoProject, times: readonly number[]): number[] {
  const { music } = video;
  if (music === undefined) {
    return [];
  }
  return times.filter((time) => time >= music.trim).map((time) => time - music.trim + music.start);
}

// The sound effects

/** The sound effects in the order they start in the video: the numbers `timeline` gives them */
export function soundsByTime(video: VideoProject): SoundEffect[] {
  return (video.sounds ?? []).slice().sort((a, b) => a.at - b.at);
}

/** Whether there is anything to hear under a video: a song, or sound effects */
export function hasAudio(video: VideoProject): boolean {
  return video.music !== undefined || (video.sounds ?? []).length > 0;
}

/**
 * Where a sound effect plays when the video plays from `time` and ends at `length`: `wait` seconds from
 * then (none when it is sounding already), from `offset` into the sound, for `span` seconds (cut where the
 * video ends). Undefined when it is over by then
 */
export function soundPlayback(
  sound: SoundEffect,
  time: number,
  length: number,
): { wait: number; offset: number; span: number } | undefined {
  const span = Math.min(length, sound.at + sound.duration) - Math.max(sound.at, time);
  if (span <= 0) {
    return undefined;
  }
  return { wait: Math.max(0, sound.at - time), offset: Math.max(0, time - sound.at), span };
}

/**
 * A time snapped to the nearest of `marks` (beats, the edges of other blocks, the playhead) when it is
 * within `threshold` seconds of one; else as it is
 */
export function snapTime(time: number, marks: readonly number[], threshold: number): number {
  let best = time;
  let distance = threshold;
  for (const mark of marks) {
    const d = Math.abs(mark - time);
    if (d <= distance) {
      best = mark;
      distance = d;
    }
  }
  return best;
}

// Storage

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isRect = (r: unknown): r is Rect => {
  const { x, y, width: w, height: h } = (r ?? {}) as Partial<Rect>;
  return isNumber(x) && isNumber(y) && isNumber(w) && isNumber(h) && w > 0 && h > 0;
};
const isEasing = (easing: unknown): easing is Easing => EASINGS.some((e) => e.easing === easing);

function posesFromRow(value: unknown): Record<string, Pose> {
  const poses: Record<string, Pose> = {};
  for (const [id, pose] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (isRect(pose)) {
      const crop = cropFromRow((pose as Pose).crop);
      const rect = { x: pose.x, y: pose.y, width: pose.width, height: pose.height };
      poses[id] = crop !== undefined ? { ...rect, crop } : rect;
    }
  }
  return poses;
}

/** A video read back from storage, or undefined when it is not one */
export function videoFromRow(value: unknown): VideoProject | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const { width, height, fps, background, frame, camera, layouts, motions, music } = row;
  if (typeof width !== 'number' || typeof height !== 'number') {
    return undefined;
  }
  const size = videoSize(width, height);
  const lengthOf = (n: unknown) => (isNumber(n) && n > 0 ? n : DEFAULT_BLOCK_LENGTH);

  const validCamera: CameraStop[] = [];
  const validLayouts: LayoutBlock[] = [];
  // Stored by the first version, as shots: each a camera stop and a layout
  if (Array.isArray(row.shots)) {
    row.shots.forEach((stored: Record<string, unknown>, i) => {
      if (typeof stored.id !== 'string' || !isRect(stored.frame)) {
        return;
      }
      const duration = isNumber(stored.duration) ? stored.duration : DEFAULT_ARRIVAL_TIME;
      const length = (i === 0 ? 0 : duration) + (isNumber(stored.hold) ? stored.hold : 1);
      const easing = isEasing(stored.easing) ? stored.easing : 'smooth';
      validCamera.push({
        id: stored.id,
        frame: stored.frame,
        length: lengthOf(length),
        arrival: 'glide',
        arrivalTime: duration,
        stay: 'still',
        easing,
      });
      validLayouts.push({
        id: `${stored.id}-layout`,
        poses: posesFromRow(stored.poses),
        length: lengthOf(length),
        transition: duration,
        easing,
      });
    });
  }
  for (const stored of Array.isArray(camera) ? camera : []) {
    const stop = (stored ?? {}) as Partial<CameraStop>;
    if (typeof stop.id !== 'string' || !isRect(stop.frame)) {
      continue;
    }
    validCamera.push({
      id: stop.id,
      frame: stop.frame,
      length: lengthOf(stop.length),
      arrival: ARRIVALS.some((a) => a.arrival === stop.arrival) ? stop.arrival! : 'glide',
      arrivalTime:
        isNumber(stop.arrivalTime) && stop.arrivalTime >= 0
          ? stop.arrivalTime
          : DEFAULT_ARRIVAL_TIME,
      stay: STAYS.some((s) => s.stay === stop.stay) ? stop.stay! : 'still',
      easing: isEasing(stop.easing) ? stop.easing : 'smooth',
    });
  }
  for (const stored of Array.isArray(layouts) ? layouts : []) {
    const layout = (stored ?? {}) as Partial<LayoutBlock>;
    if (typeof layout.id !== 'string') {
      continue;
    }
    validLayouts.push({
      id: layout.id,
      poses: posesFromRow(layout.poses),
      length: lengthOf(layout.length),
      transition:
        isNumber(layout.transition) && layout.transition >= 0
          ? layout.transition
          : DEFAULT_ARRIVAL_TIME,
      easing: isEasing(layout.easing) ? layout.easing : 'smooth',
    });
  }
  const validMotions: Motion[] = [];
  for (const stored of Array.isArray(motions) ? motions : []) {
    const motion = (stored ?? {}) as Partial<Motion>;
    if (
      typeof motion.id === 'string' &&
      isMotionKind(motion.kind) &&
      Array.isArray(motion.targets) &&
      isNumber(motion.start) &&
      isNumber(motion.length) &&
      motion.length > 0
    ) {
      validMotions.push({
        id: motion.id,
        kind: motion.kind,
        targets: motion.targets.filter((t): t is string => typeof t === 'string'),
        start: Math.max(0, motion.start),
        length: motion.length,
        strength: isNumber(motion.strength) ? Math.min(2, Math.max(0, motion.strength)) : 1,
        speed: isNumber(motion.speed) ? Math.min(4, Math.max(0.1, motion.speed)) : 1,
        stagger: isNumber(motion.stagger) ? Math.min(2, Math.max(0, motion.stagger)) : 0,
      });
    }
  }
  return {
    ...size,
    fps: fps === 60 ? 60 : 30,
    background: typeof background === 'string' ? background : '#000000',
    frame: isRect(frame)
      ? frame
      : validCamera[0]?.frame ?? { x: 0, y: 0, width: size.width, height: size.height },
    camera: validCamera,
    layouts: validLayouts,
    motions: validMotions,
    music: musicFromRow(music),
    sounds: soundsFromRow(row.sounds),
    end: isNumber(row.end) && row.end > 0 ? row.end : undefined,
  };
}

function musicFromRow(value: unknown): MusicTrack | undefined {
  const music = (value ?? {}) as Partial<MusicTrack>;
  if (typeof music.path !== 'string' || !isNumber(music.duration) || music.duration <= 0) {
    return undefined;
  }
  return {
    path: music.path,
    name: typeof music.name === 'string' ? music.name : music.path,
    start: isNumber(music.start) ? music.start : 0,
    trim: isNumber(music.trim) && music.trim >= 0 ? music.trim : 0,
    duration: music.duration,
    volume: isNumber(music.volume) ? Math.min(1, Math.max(0, music.volume)) : 1,
    bpm: isNumber(music.bpm) ? music.bpm : 0,
    beats: Array.isArray(music.beats) ? music.beats.filter(isNumber) : [],
    swells: Array.isArray(music.swells) ? music.swells.filter(isNumber) : undefined,
  };
}

/** The sound effects stored: those that are not one are left out; undefined when none are stored */
function soundsFromRow(value: unknown): SoundEffect[] | undefined {
  return Array.isArray(value)
    ? value.map(soundFromRow).filter((sound): sound is SoundEffect => sound !== undefined)
    : undefined;
}

function soundFromRow(value: unknown): SoundEffect | undefined {
  const sound = (value ?? {}) as Partial<SoundEffect>;
  if (
    typeof sound.id !== 'string' ||
    typeof sound.path !== 'string' ||
    !isNumber(sound.at) ||
    !isNumber(sound.duration) ||
    sound.duration <= 0
  ) {
    return undefined;
  }
  return {
    id: sound.id,
    path: sound.path,
    name: typeof sound.name === 'string' ? sound.name : sound.path,
    at: Math.max(0, sound.at),
    volume: isNumber(sound.volume)
      ? Math.min(MAX_SOUND_VOLUME, Math.max(0, sound.volume))
      : SOUND_VOLUME,
    duration: sound.duration,
  };
}

/**
 * Cut to the beat: a whole video edit made from the beats of its song, where its photos are, a style and a
 * seed. The camera's stops, how long each layout lasts, and the motions; every cut on a beat. The same
 * seed gives the same edit again, another seed another one of the same photos.
 */
import { seededRandom, shuffled } from './core';
import { CameraStop, Easing, frameAround, frameFilledBy } from './video';
import { Motion } from './video-motion';
import { boundsOf, Rect } from './workspace';

/**
 * How the edit moves: `cuts` (short shots cut on every other beat), `flow` (long glides and drifts) or
 * `mixed` (both, in turn)
 */
export type EditStyle = 'cuts' | 'flow' | 'mixed';

export const EDIT_STYLES: readonly { style: EditStyle; name: string; detail: string }[] = [
  { style: 'cuts', name: 'Cuts', detail: 'Short shots, cut on the beat' },
  { style: 'flow', name: 'Flow', detail: 'Long glides and drifts' },
  { style: 'mixed', name: 'Mixed', detail: 'Both, in turn' },
];

export interface EditInput {
  /** The beats of the song in seconds of the video; none: a beat every half second */
  beats: readonly number[];
  /** How long the video is, in seconds */
  length: number;
  /** Width for height of the video */
  aspect: number;
  /** Where every photo is in each layout, in the order they follow one another; one at least */
  layouts: readonly ReadonlyMap<string, Rect>[];
  /** Where the title and the line under it are, if there is a title: the first shot shows it */
  title?: Rect;
  style: EditStyle;
  seed: number;
  /** A new id for a camera stop or a motion */
  newId: () => string;
}

export interface Edit {
  camera: CameraStop[];
  /** How long each layout lasts, in their order */
  layoutLengths: number[];
  motions: Motion[];
}

/** Beats a section lasts: two bars */
const SECTION = 8;
/** Beats the opening shot lasts: two bars, the title shown while the photos come in */
const INTRO = 8;
/** Beats the first photo fills the screen at the start, before the title: a bar */
const OPENING = 4;
/** How long the last shot and the fading out at the end take at least, in seconds */
const ENDING = 1.6;
/** How long a layout that does not fit in the video lasts, after its end (kept, not shown), in seconds */
const LAYOUT_AFTER_END = 2;

/** A shot of the edit before it is a camera stop: what it shows and how it gets there */
interface Shot {
  frame: Rect;
  from: number;
  arrival: CameraStop['arrival'];
  stay: CameraStop['stay'];
}

export function autoEdit(input: EditInput): Edit {
  const { length, aspect, layouts, style, newId } = input;
  const random = seededRandom(input.seed);
  const beats = beatGrid(input.beats, length);
  // Where each section begins (in beats), until the ending
  const lastBeat = beats.findIndex((beat) => beat > length - ENDING);
  const usable = lastBeat === -1 ? beats.length : lastBeat;

  const timeOf = (b: number) => (b >= beats.length ? length : beats[b]);

  // The layouts follow one another at section boundaries (each its own), evenly over the video; those
  // there is no section left for come after its end
  const boundaries = usable > INTRO ? Math.ceil((usable - INTRO) / SECTION) : 0;
  const shown = Math.min(layouts.length, 1 + boundaries);
  const layoutStarts = Array.from({ length: shown }, (_, i) =>
    i === 0 ? 0 : INTRO + Math.floor((i * boundaries) / shown) * SECTION,
  );
  const layoutAt = (beat: number) => {
    let index = 0;
    layoutStarts.forEach((start, i) => beat >= start && (index = i));
    return index;
  };
  const photosOf = (layout: number) => [...layouts[layout].keys()];
  const placeOf = (id: string, layout: number) => layouts[layout].get(id)!;
  const everything = (layout: number) =>
    boundsOf([...layouts[layout].values(), ...(input.title !== undefined ? [input.title] : [])])!;

  // Photos of the layout in turn, none again until all were shown
  let pool: string[] = [];
  let poolLayout = 0;
  let previous: string | undefined;
  const nextPhoto = (layout: number): string => {
    if (pool.length === 0 || poolLayout !== layout) {
      pool = shuffled(photosOf(layout), random).filter((id) => id !== previous);
      poolLayout = layout;
    }
    const id = pool.shift() ?? photosOf(layout)[0];
    previous = id;
    return id;
  };
  /** A photo and the three nearest it, in a layout */
  const groupAround = (id: string, layout: number): string[] => {
    const middle = centreOf(placeOf(id, layout));
    return photosOf(layout)
      .sort(
        (a, b) =>
          distance(centreOf(placeOf(a, layout)), middle) -
          distance(centreOf(placeOf(b, layout)), middle),
      )
      .slice(0, 4);
  };

  const shots: Shot[] = [];
  /** A shot of the same frame as the one before is no cut: that one goes on */
  const shoot = (shot: Shot) => {
    const last = shots[shots.length - 1];
    if (last === undefined || !isSameRect(last.frame, shot.frame)) {
      shots.push(shot);
    }
  };
  const motions: Motion[] = [];
  const motion = (
    kind: Motion['kind'],
    targets: string[],
    start: number,
    end: number,
    strength = 1,
  ) =>
    end > start &&
    targets.length > 0 &&
    motions.push({
      id: newId(),
      kind,
      targets,
      start,
      length: end - start,
      strength,
      speed: 1,
      stagger: kind === 'drop-in' ? Math.min(0.05, (beats[INTRO] ?? 2) / 2 / targets.length) : 0,
    });

  // The opening: the first photo filling the screen from the first frame (the video's cover), then the
  // title (or everything) as the other photos come in
  const intro = Math.min(INTRO, usable);
  const [opener, ...others] = photosOf(0);
  shoot({
    frame: frameFilledBy(placeOf(opener, 0), aspect),
    from: 0,
    arrival: 'cut',
    stay: 'push-in',
  });
  const isTitleShown = intro > OPENING;
  if (isTitleShown) {
    shoot({
      frame:
        input.title !== undefined
          ? frameAround(input.title, aspect, 0.12)
          : frameAround(everything(0), aspect, 0.04),
      from: OPENING,
      arrival: 'glide',
      stay: 'push-in',
    });
  }
  const dropIn = isTitleShown ? timeOf(OPENING) : 0.3;
  motion('drop-in', others, dropIn, dropIn + Math.min(0.8, beats[intro] ?? 1));

  // The sections, until the ending
  let beat = intro;
  let section = 0;
  while (beat < usable) {
    const layout = layoutAt(beat);
    const end = Math.min(usable, beat + SECTION);
    if (layoutStarts.includes(beat) && beat > 0) {
      // A new layout: everything, as the photos glide to their new places, shaken as they land
      shoot({
        frame: frameAround(everything(layout), aspect, 0.03),
        from: beat,
        arrival: 'glide',
        stay: 'push-in',
      });
      motion('shake', photosOf(layout), beats[beat], beats[beat] + 0.4, 0.6);
    } else {
      const kind = sectionKind(style, section, random);
      if (kind === 'cuts') {
        const cut: string[] = [];
        for (let b = beat; b < end; b += 2) {
          const id = nextPhoto(layout);
          cut.push(id);
          shoot({
            frame: frameFilledBy(placeOf(id, layout), aspect),
            from: b,
            arrival: (b - beat) % 4 === 0 ? 'cut' : 'whip',
            stay: random() < 0.5 ? 'drift' : 'push-in',
          });
        }
        motion('pulse', cut, beats[beat], timeOf(end), 0.8);
      } else if (kind === 'sweep') {
        // From one photo to another across the layout, the camera moving all the way
        const from = nextPhoto(layout);
        const to = nextPhoto(layout);
        shoot({
          frame: frameAround(placeOf(from, layout), aspect, 0.3),
          from: beat,
          arrival: 'cut',
          stay: 'still',
        });
        if (end - beat >= 4) {
          shoot({
            frame: frameAround(placeOf(to, layout), aspect, 0.3),
            from: beat + 4,
            arrival: 'scroll',
            stay: 'still',
          });
        }
      } else if (kind === 'group') {
        const group = groupAround(nextPhoto(layout), layout);
        shoot({
          frame: frameAround(boundsOf(group.map((id) => placeOf(id, layout)))!, aspect, 0.04),
          from: beat,
          arrival: 'glide',
          stay: 'drift',
        });
        motion('jiggle', group.slice(0, 2), beats[beat], timeOf(end), 0.6);
      } else {
        shoot({
          frame: frameAround(everything(layout), aspect, 0.03),
          from: beat,
          arrival: 'glide',
          stay: 'pull-out',
        });
      }
    }
    beat = end;
    section++;
  }
  // The ending: everything, the camera pulling back as it all fades
  const lastLayout = shown - 1;
  shoot({
    frame: frameAround(everything(lastLayout), aspect, 0.06),
    from: usable,
    arrival: 'glide',
    stay: 'pull-out',
  });
  const everyId = [...new Set(layouts.flatMap((l) => [...l.keys()]))];
  motion('fade-out', everyId, Math.max(0, length - ENDING), length - 0.2);

  // Shots to camera stops: each lasts until the next begins, the last until the end
  const camera: CameraStop[] = shots.map((shot, i) => {
    const start = timeOf(shot.from);
    const until = i + 1 < shots.length ? timeOf(shots[i + 1].from) : length;
    return {
      id: newId(),
      frame: shot.frame,
      length: Math.max(0.1, until - start),
      arrival: shot.arrival,
      arrivalTime: shot.arrival === 'glide' ? 0.7 : 0.35,
      stay: shot.stay,
      easing: 'smooth' as Easing,
    };
  });
  const layoutLengths = layouts.map((_, i) =>
    i < shown
      ? (i + 1 < shown ? timeOf(layoutStarts[i + 1]) : length) - timeOf(layoutStarts[i])
      : LAYOUT_AFTER_END,
  );
  return { camera, layoutLengths, motions };
}

/** The beats from 0 on, or a beat every half second for a video without a steady one */
function beatGrid(beats: readonly number[], length: number): number[] {
  const after = beats.filter((beat) => beat >= 0 && beat < length);
  if (after.length >= 8) {
    // The first shot begins at 0 whatever the song does
    return after[0] < 0.05 ? after : [0, ...after];
  }
  return Array.from({ length: Math.floor(length / 0.5) }, (_, i) => i * 0.5);
}

/** What a section of an edit of a style is: chosen by the seed, so the edit varies */
function sectionKind(
  style: EditStyle,
  section: number,
  random: () => number,
): 'cuts' | 'sweep' | 'group' | 'wide' {
  const r = random();
  if (style === 'cuts') {
    return r < 0.65 ? 'cuts' : r < 0.85 ? 'sweep' : 'wide';
  }
  if (style === 'flow') {
    return r < 0.45 ? 'group' : r < 0.75 ? 'sweep' : 'wide';
  }
  return section % 2 === 0 ? (r < 0.7 ? 'cuts' : 'sweep') : r < 0.6 ? 'group' : 'wide';
}

const isSameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const centreOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

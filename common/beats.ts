/**
 * Finding the beats of a song, so that the edit of a video can snap to them. Most songs keep one tempo,
 * so this finds one: how often loud onsets come back (the tempo), and where the first of them falls (the
 * phase), and lays an even grid of beats over the whole song from there.
 *
 * 1. The onsets: how much louder each short stretch is than the one before, measured on the signal's
 *    changes (which brings out drums and plucks over held notes).
 * 2. The tempo: the spacing at which the onsets match themselves best, among 60 to 200 beats a minute,
 *    preferring tempos near 120 (a song at 70 matches itself at 140 too).
 * 3. The phase: where a grid of that spacing lands on the most onsets.
 */

export interface BeatGrid {
  /** Beats per minute */
  bpm: number;
  /** The beats, in seconds from the start of the song */
  beats: number[];
}

const HOP = 512;
const WINDOW = 1024;
const MIN_BPM = 60;
const MAX_BPM = 200;

/** The beats of a song, from its samples (one channel, -1 to 1) */
export function findBeats(samples: Float32Array, sampleRate: number): BeatGrid {
  const onsets = onsetStrength(samples);
  const frameTime = HOP / sampleRate;
  if (onsets.length < 8) {
    return { bpm: 0, beats: [] };
  }
  let period = bestPeriod(onsets, frameTime);
  if (period === undefined) {
    return { bpm: 0, beats: [] };
  }
  const { offset, period: exact } = fitGrid(onsets, bestOffset(onsets, period), period);
  period = exact;
  const beats: number[] = [];
  const duration = samples.length / sampleRate;
  // A beat shows in the first window that takes it in, which begins up to a window earlier than it
  const lag = (WINDOW - HOP / 2) / sampleRate;
  for (let frame = offset; frame * frameTime + lag < duration; frame += period) {
    beats.push(Math.round((frame * frameTime + lag) * 1000) / 1000);
  }
  return { bpm: Math.round((600 / (period * frameTime)) * 1) / 10, beats };
}

/** How long the loudness is averaged over to find a swell, in seconds: waves, not splashes */
const SWELL_SMOOTHING = 1.2;
/** How far apart swells are at least, in seconds */
const MIN_SWELL_GAP = 3;

/**
 * The swells of a sound without a beat (the sea, wind, a pad): when it is loudest, its loudness averaged
 * over about a second, each the loudest within `MIN_SWELL_GAP` around it and louder than the sound is
 * on the whole. In seconds from its start
 */
export function findSwells(samples: Float32Array, sampleRate: number): number[] {
  const step = Math.round(sampleRate / 10);
  const count = Math.floor(samples.length / step);
  const loudness = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let energy = 0;
    for (let i = f * step; i < (f + 1) * step; i++) {
      energy += samples[i] * samples[i];
    }
    loudness[f] = Math.sqrt(energy / step);
  }
  const reach = Math.round((SWELL_SMOOTHING * 10) / 2);
  const smooth = loudness.map((_, f) => {
    const from = Math.max(0, f - reach);
    const to = Math.min(count, f + reach + 1);
    return loudness.slice(from, to).reduce((sum, value) => sum + value, 0) / (to - from);
  });
  const mean = smooth.reduce((sum, value) => sum + value, 0) / Math.max(1, count);
  const gap = MIN_SWELL_GAP * 10;
  const swells: number[] = [];
  for (let f = 0; f < count; f++) {
    const around = smooth.slice(Math.max(0, f - gap / 2), f + gap / 2 + 1);
    if (smooth[f] > mean && smooth[f] === Math.max(...around)) {
      // A plateau is one swell: its first frame
      if (swells.length === 0 || f / 10 - swells[swells.length - 1] >= MIN_SWELL_GAP / 2) {
        swells.push(f / 10);
      }
    }
  }
  return swells;
}

/** How much louder each frame is than the one before, its changes only, the steady part taken away */
function onsetStrength(samples: Float32Array): Float32Array {
  const count = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const loudness = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let energy = 0;
    const from = f * HOP;
    for (let i = from + 1; i < from + WINDOW; i++) {
      const change = samples[i] - samples[i - 1];
      energy += change * change;
    }
    loudness[f] = Math.log(1e-9 + energy);
  }
  const rises = new Float32Array(count);
  for (let f = 1; f < count; f++) {
    rises[f] = Math.max(0, loudness[f] - loudness[f - 1]);
  }
  // Less what is usual around it (about a third of a second), so that a loud passage is no onset by itself
  const around = 16;
  const onsets = new Float32Array(count);
  let sum = 0;
  for (let f = 0; f < count; f++) {
    sum += rises[f];
    if (f >= around) {
      sum -= rises[f - around];
    }
    const mean = sum / Math.min(f + 1, around);
    onsets[f] = Math.max(0, rises[f] - mean);
  }
  return onsets;
}

/** The spacing of beats, in frames (not whole), that the onsets match best, near 120 a minute */
function bestPeriod(onsets: Float32Array, frameTime: number): number | undefined {
  const shortest = Math.floor(60 / MAX_BPM / frameTime);
  const longest = Math.ceil(60 / MIN_BPM / frameTime);
  // An onset matches one a frame either side too: a beat is rarely a whole number of frames long, and
  // without this a spacing of two beats (closer to whole) would match better than one
  const near = onsets.map((value, f) => Math.max(value, onsets[f - 1] ?? 0, onsets[f + 1] ?? 0));
  const scores: number[] = [];
  let best = -1;
  let bestScore = 0;
  for (let lag = shortest; lag <= longest; lag++) {
    let score = 0;
    for (let f = 0; f + lag < onsets.length; f++) {
      score += onsets[f] * near[f + lag];
    }
    score /= onsets.length - lag;
    const bpm = 60 / (lag * frameTime);
    // A tempo an octave from 120 counts a little over half as much
    const preference = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.1, 2));
    scores[lag] = score * preference;
    if (scores[lag] > bestScore) {
      bestScore = scores[lag];
      best = lag;
    }
  }
  if (best === -1) {
    return undefined;
  }
  // Between whole frames: the top of the parabola through the best and its neighbours
  const before = scores[best - 1] ?? scores[best];
  const after = scores[best + 1] ?? scores[best];
  const curve = before - 2 * scores[best] + after;
  const shift = curve < 0 ? (0.5 * (before - after)) / curve : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

/**
 * The grid made exact: the strongest onset near each beat of the guessed grid, and the straight line
 * through them (least squares), twice. A small error in the spacing would otherwise add up, beat after
 * beat, over a whole song.
 */
function fitGrid(
  onsets: Float32Array,
  offset: number,
  period: number,
): { offset: number; period: number } {
  let grid = { offset, period };
  for (let round = 0; round < 2; round++) {
    const points: { k: number; frame: number }[] = [];
    const reach = Math.max(1, Math.round(grid.period * 0.2));
    for (let k = 0; grid.offset + k * grid.period < onsets.length; k++) {
      const expected = Math.round(grid.offset + k * grid.period);
      let best = -1;
      let strongest = 0;
      for (let f = expected - reach; f <= expected + reach; f++) {
        if ((onsets[f] ?? 0) > strongest) {
          strongest = onsets[f];
          best = f;
        }
      }
      if (best !== -1) {
        points.push({ k, frame: best });
      }
    }
    if (points.length < 4) {
      return grid;
    }
    const n = points.length;
    const sumK = points.reduce((s, p) => s + p.k, 0);
    const sumF = points.reduce((s, p) => s + p.frame, 0);
    const sumKK = points.reduce((s, p) => s + p.k * p.k, 0);
    const sumKF = points.reduce((s, p) => s + p.k * p.frame, 0);
    const slope = (n * sumKF - sumK * sumF) / (n * sumKK - sumK * sumK);
    if (!Number.isFinite(slope) || slope <= 0) {
      return grid;
    }
    grid = { offset: (sumF - slope * sumK) / n, period: slope };
  }
  // The first beat within the first period
  const first = ((grid.offset % grid.period) + grid.period) % grid.period;
  return { offset: first, period: grid.period };
}

/** Where, within the first beat, a grid of `period` lands on the most onsets */
function bestOffset(onsets: Float32Array, period: number): number {
  let best = 0;
  let bestScore = -1;
  for (let offset = 0; offset < period; offset++) {
    let score = 0;
    for (let frame = offset; frame < onsets.length; frame += period) {
      // The strongest onset right at, or next to, where the beat falls
      const f = Math.round(frame);
      score += Math.max(onsets[f] ?? 0, 0.5 * (onsets[f - 1] ?? 0), 0.5 * (onsets[f + 1] ?? 0));
    }
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  return best;
}

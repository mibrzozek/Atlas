import { findBeats, findSwells } from '../common/beats';

/** A made-up song: a short burst of noise on every beat, over a quiet hum */
function song(bpm: number, firstBeat: number, seconds: number, sampleRate = 22050): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  let seed = 1;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.05 * Math.sin((i / sampleRate) * 2 * Math.PI * 110);
  }
  for (let beat = firstBeat; beat < seconds; beat += 60 / bpm) {
    const from = Math.round(beat * sampleRate);
    for (let i = 0; i < 0.03 * sampleRate && from + i < samples.length; i++) {
      samples[from + i] += noise() * Math.exp(-i / (0.008 * sampleRate));
    }
  }
  return samples;
}

describe('finding the swells of a sound without a beat', () => {
  it('finds when made-up surf is loudest', () => {
    const sampleRate = 8000;
    let seed = 7;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    // Surf: noise that swells every 6 s, loudest at 3, 9, 15, 21 and 27 s
    const samples = Float32Array.from({ length: 30 * sampleRate }, (_, i) => {
      const t = i / sampleRate;
      return noise() * (0.2 + 0.8 * Math.max(0, Math.sin(((t - 1.5) / 6) * 2 * Math.PI)) ** 2);
    });
    const swells = findSwells(samples, sampleRate);
    expect(swells).toHaveLength(5);
    swells.forEach((swell, i) => expect(Math.abs(swell - (3 + i * 6))).toBeLessThan(0.4));
  });
});

describe('finding the beats of a song', () => {
  it.each([
    [120, 0.25],
    [96, 0.1],
    [140, 0.4],
  ])('finds %d beats a minute, starting at %f s', (bpm, first) => {
    const grid = findBeats(song(bpm, first, 20), 22050);
    expect(grid.bpm).toBeGreaterThan(bpm * 0.98);
    expect(grid.bpm).toBeLessThan(bpm * 1.02);
    // Every beat within 30 ms of where it is
    const period = 60 / bpm;
    for (const beat of grid.beats) {
      const off = (((beat - first) % period) + period) % period;
      expect(Math.min(off, period - off)).toBeLessThan(0.03);
    }
    expect(grid.beats.length).toBeGreaterThan(20 / period - 2);
  });

  it('finds nothing in silence or in too little', () => {
    expect(findBeats(new Float32Array(100), 22050).beats).toEqual([]);
  });
});

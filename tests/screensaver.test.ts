import {
  DEFAULT_SCREENSAVER_SETTINGS,
  MAX_TILE_TRIM,
  clampIdleMinutes,
  clampSecondsPerImage,
  getLaneCount,
  layoutLanes,
  shouldStartScreensaver,
  shuffled,
} from '../common/screensaver';

describe('shouldStartScreensaver', () => {
  const settings = { ...DEFAULT_SCREENSAVER_SETTINGS, idleMinutes: 5 };
  const idleFor = (minutes: number, isWindowActive = true) => ({
    systemIdleSeconds: minutes * 60,
    isWindowActive,
  });

  it('starts once the system has been idle for the configured time', () => {
    expect(shouldStartScreensaver(settings, idleFor(4.9), false)).toBe(false);
    expect(shouldStartScreensaver(settings, idleFor(5), false)).toBe(true);
    expect(shouldStartScreensaver(settings, idleFor(60), false)).toBe(true);
  });

  it('does not start when it is switched off', () => {
    expect(shouldStartScreensaver({ ...settings, isEnabled: false }, idleFor(60), false)).toBe(
      false,
    );
  });

  it('does not start when another application is in front', () => {
    expect(shouldStartScreensaver(settings, idleFor(60, false), false)).toBe(false);
  });

  it('does not start again while it is running', () => {
    expect(shouldStartScreensaver(settings, idleFor(60), true)).toBe(false);
  });
});

describe('settings limits', () => {
  it('keeps values within their limits and falls back on nonsense', () => {
    expect(clampIdleMinutes(0)).toBe(1);
    expect(clampIdleMinutes(10)).toBe(10);
    expect(clampIdleMinutes(100000)).toBe(240);
    expect(clampIdleMinutes('abc')).toBe(DEFAULT_SCREENSAVER_SETTINGS.idleMinutes);
    expect(clampSecondsPerImage(0)).toBe(2);
    expect(clampSecondsPerImage(undefined)).toBe(DEFAULT_SCREENSAVER_SETTINGS.secondsPerImage);
  });
});

describe('shuffled', () => {
  it('returns all items, and leaves the original list alone', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const result = shuffled(items, () => 0.3);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.slice().sort()).toEqual(items);
    expect(result).not.toEqual(items);
  });
});

describe('layoutLanes', () => {
  // A repeating mix of landscape, portrait and square images
  const ratios = [1.5, 0.667, 1.5, 1, 1.5, 0.667, 1.778];
  const ratioAt = (i: number) => ratios[i % ratios.length];
  const screen = { width: 1920, height: 1080 };
  const gap = 8;
  const rows = {
    orientation: 'rows' as const,
    laneCount: 3,
    laneLength: screen.width,
    crossLength: screen.height,
    gap,
  };
  const columns = {
    orientation: 'columns' as const,
    laneCount: 5,
    laneLength: screen.height,
    crossLength: screen.width,
    gap,
  };
  const lanesOf = (placements: ReturnType<typeof layoutLanes>, count: number) =>
    Array.from({ length: count }, (_, lane) => placements.filter((p) => p.lane === lane));

  for (const [name, options] of [
    ['rows', rows],
    ['columns', columns],
  ] as const) {
    const isRows = options.orientation === 'rows';
    // Along the lane, and across it
    const start = (p: { x: number; y: number }) => (isRows ? p.x : p.y);
    const size = (p: { width: number; height: number }) => (isRows ? p.width : p.height);
    const crossStart = (p: { x: number; y: number }) => (isRows ? p.y : p.x);
    const crossSize = (p: { width: number; height: number }) => (isRows ? p.height : p.width);

    it(`keeps every image completely on screen and close to its own shape (${name})`, () => {
      for (let first = 0; first < 25; first++) {
        const placements = layoutLanes(ratioAt, first, options);
        for (const p of placements) {
          expect(p.x).toBeGreaterThanOrEqual(gap - 0.001);
          expect(p.y).toBeGreaterThanOrEqual(gap - 0.001);
          expect(p.x + p.width).toBeLessThanOrEqual(screen.width - gap + 0.001);
          expect(p.y + p.height).toBeLessThanOrEqual(screen.height - gap + 0.001);
          // Only a sliver of the image may be hidden to make the lanes reach the edges
          const trim = Math.abs(p.width / p.height / ratioAt(p.sequenceIndex) - 1);
          expect(trim).toBeLessThanOrEqual(MAX_TILE_TRIM / (1 - MAX_TILE_TRIM) + 0.001);
        }
      }
    });

    it(`looks like the gallery: lanes line up, with the same space everywhere (${name})`, () => {
      for (let first = 0; first < 25; first++) {
        const placements = layoutLanes(ratioAt, first, options);
        const lanes = lanesOf(placements, options.laneCount);
        expect(lanes.every((lane) => lane.length > 0)).toBe(true);
        const firstLane = lanes[0];
        const begin = start(firstLane[0]);
        const end = start(firstLane[firstLane.length - 1]) + size(firstLane[firstLane.length - 1]);
        lanes.forEach((lane, laneIndex) => {
          // Every lane begins and ends at the same place
          expect(start(lane[0])).toBeCloseTo(begin, 3);
          expect(start(lane[lane.length - 1]) + size(lane[lane.length - 1])).toBeCloseTo(end, 3);
          for (let i = 1; i < lane.length; i++) {
            // The same space between all images of a lane, which all have the same thickness
            expect(start(lane[i]) - (start(lane[i - 1]) + size(lane[i - 1]))).toBeCloseTo(gap, 3);
            expect(crossSize(lane[i])).toBeCloseTo(crossSize(lane[0]), 3);
          }
          if (laneIndex > 0) {
            const before = lanes[laneIndex - 1][0];
            expect(crossStart(lane[0]) - (crossStart(before) + crossSize(before))).toBeCloseTo(
              gap,
              3,
            );
          }
        });
      }
    });

    it(`reaches all edges of the screen (${name})`, () => {
      for (let first = 0; first < 25; first++) {
        const placements = layoutLanes(ratioAt, first, options);
        // Where the limit on trimming is reached, a margin of a few pixels may remain
        const tolerance = 4;
        const left = Math.min(...placements.map((p) => p.x));
        const top = Math.min(...placements.map((p) => p.y));
        const right = Math.max(...placements.map((p) => p.x + p.width));
        const bottom = Math.max(...placements.map((p) => p.y + p.height));
        expect(left).toBeGreaterThanOrEqual(gap - 0.001);
        expect(left).toBeLessThanOrEqual(gap + tolerance);
        expect(top).toBeGreaterThanOrEqual(gap - 0.001);
        expect(top).toBeLessThanOrEqual(gap + tolerance);
        expect(right).toBeLessThanOrEqual(screen.width - gap + 0.001);
        expect(right).toBeGreaterThanOrEqual(screen.width - gap - tolerance);
        expect(bottom).toBeLessThanOrEqual(screen.height - gap + 0.001);
        expect(bottom).toBeGreaterThanOrEqual(screen.height - gap - tolerance);
      }
    });

    it(`shows consecutive images in reading order (${name})`, () => {
      const placements = layoutLanes(ratioAt, 7, options);
      expect(placements.map((p) => p.sequenceIndex)).toEqual(placements.map((_, i) => 7 + i));
      const laneOfEach = placements.map((p) => p.lane);
      expect(laneOfEach).toEqual(laneOfEach.slice().sort((a, b) => a - b));
    });
  }

  it('moves every image one place forward when the sequence advances', () => {
    const before = layoutLanes(ratioAt, 3, rows);
    const after = layoutLanes(ratioAt, 4, rows);
    expect(after[0].sequenceIndex).toBe(before[1].sequenceIndex);
    expect(after.some((p) => p.sequenceIndex === before[0].sequenceIndex)).toBe(false);
    expect(after[after.length - 1].sequenceIndex).toBeGreaterThanOrEqual(
      before[before.length - 1].sequenceIndex,
    );
  });

  it('never cuts off a very wide or very tall image', () => {
    for (const ratio of [12, 0.08]) {
      for (const options of [rows, columns]) {
        const placements = layoutLanes(() => ratio, 0, options);
        expect(placements.length).toBeGreaterThanOrEqual(options.laneCount);
        for (const p of placements) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x + p.width).toBeLessThanOrEqual(screen.width + 0.001);
          expect(p.y + p.height).toBeLessThanOrEqual(screen.height + 0.001);
          const trim = Math.abs(p.width / p.height / ratio - 1);
          expect(trim).toBeLessThanOrEqual(MAX_TILE_TRIM / (1 - MAX_TILE_TRIM) + 0.001);
        }
      }
    }
  });

  it('copes with unknown image sizes', () => {
    expect(layoutLanes(() => NaN, 0, rows).length).toBeGreaterThan(0);
    expect(layoutLanes(() => 0, 0, columns).length).toBeGreaterThan(0);
  });
});

describe('getLaneCount', () => {
  it('always uses three rows, and more columns on wider screens', () => {
    expect(getLaneCount('rows', 1920)).toBe(3);
    expect(getLaneCount('rows', 3840)).toBe(3);
    expect(getLaneCount('rows', 800)).toBe(3);
    expect(getLaneCount('columns', 1920)).toBe(5);
    expect(getLaneCount('columns', 7680)).toBe(8);
    expect(getLaneCount('columns', 600)).toBe(3);
  });
});

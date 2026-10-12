import {
  DEFAULT_SCREENSAVER_SETTINGS,
  ImagePool,
  MAX_TILE_TRIM,
  WALL_SPARE_FACTOR,
  clampIdleMinutes,
  clampSecondsPerImage,
  coverPixels,
  estimateWallCount,
  getLaneCount,
  layoutLanes,
  layoutShowcase,
  planScreens,
  shouldStartScreensaver,
  shuffled,
  snapToDevicePixels,
  withoutDuplicates,
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

describe('withoutDuplicates', () => {
  it('keeps one of every image, and one of every set of copies', () => {
    const image = (id: string, duplicateKey?: string) => ({
      id,
      src: `${id}.jpg`,
      aspectRatio: 1.5,
      duplicateKey,
    });
    const result = withoutDuplicates([
      image('a', '100:30x20'),
      image('b', '200:30x20'),
      image('a', '100:30x20'),
      image('c', '100:30x20'),
      image('d'),
      image('e'),
    ]);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'd', 'e']);
  });
});

describe('ImagePool', () => {
  // A random generator that gives the same numbers every run
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `image-${i}` }));

  it('never hands out an image that is on screen', () => {
    const pool = new ImagePool(items(10), seeded(1));
    const taken = Array.from({ length: 10 }, () => pool.take());
    expect(new Set(taken.map((i) => i?.id)).size).toBe(10);
    expect(pool.freeCount).toBe(0);
    expect(pool.take()).toBeUndefined();
  });

  it('shows all the other images before one comes back', () => {
    for (const [count, onScreen] of [
      [40, 12],
      [20, 13],
      [9, 6],
      [200, 26],
    ]) {
      const pool = new ImagePool(items(count), seeded(count));
      // A wall: the oldest image leaves, a new one comes in
      const screen = Array.from({ length: onScreen }, () => pool.take()!);
      const leftAt = new Map<string, number>();
      let shortestAbsence = Infinity;
      for (let step = 0; step < count * 30; step++) {
        const leaving = screen.shift()!;
        pool.release(leaving);
        leftAt.set(leaving.id, step);
        const entering = pool.take()!;
        expect(screen.some((i) => i.id === entering.id)).toBe(false);
        const left = leftAt.get(entering.id);
        if (left !== undefined) {
          shortestAbsence = Math.min(shortestAbsence, step - left);
        }
        screen.push(entering);
      }
      // With every image shown equally often it would be away for (count - onScreen) steps
      const fair = count - onScreen;
      expect(shortestAbsence).toBeGreaterThanOrEqual(Math.floor(fair * 0.7));
    }
  });

  it('shows every image equally often in the long run, in a different order every round', () => {
    const pool = new ImagePool(items(30), seeded(7));
    const timesShown = new Map<string, number>();
    const order: string[] = [];
    let current = pool.take()!;
    for (let step = 0; step < 3000; step++) {
      timesShown.set(current.id, (timesShown.get(current.id) ?? 0) + 1);
      order.push(current.id);
      const next = pool.take()!;
      pool.release(current);
      current = next;
    }
    const counts = Array.from(timesShown.values());
    expect(timesShown.size).toBe(30);
    // 100 times each on average
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(10);
    expect(order.slice(0, 30)).not.toEqual(order.slice(30, 60));
  });

  it('stops handing out an image that cannot be shown', () => {
    const pool = new ImagePool(items(3), seeded(3));
    const broken = pool.take()!;
    pool.remove(broken);
    expect(pool.size).toBe(2);
    const others = [pool.take(), pool.take()];
    expect(others.map((i) => i?.id)).not.toContain(broken.id);
    expect(pool.take()).toBeUndefined();
  });
});

describe('snapToDevicePixels', () => {
  it('puts the edges on whole device pixels, for any scale of the screen', () => {
    for (const dpr of [1, 1.25, 1.3, 1.5, 2, 2.625]) {
      const rect = snapToDevicePixels({ x: 8.37, y: 361.52, width: 419.71, height: 349.33 }, dpr);
      for (const edge of [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]) {
        expect(Math.abs(edge * dpr - Math.round(edge * dpr))).toBeLessThan(1e-6);
      }
      expect(rect.pixelWidth).toBe(Math.round(rect.width * dpr));
      expect(rect.pixelHeight).toBe(Math.round(rect.height * dpr));
      expect(Math.abs(rect.x - 8.37)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
    }
  });

  it('keeps the same space between neighbours', () => {
    const dpr = 1.3;
    const a = snapToDevicePixels({ x: 8, y: 8, width: 401.4, height: 300 }, dpr);
    const b = snapToDevicePixels({ x: 8 + 401.4 + 8, y: 8, width: 512.2, height: 300 }, dpr);
    const gapInPixels = (b.x - (a.x + a.width)) * dpr;
    expect(Math.abs(gapInPixels - Math.round(gapInPixels))).toBeLessThan(1e-6);
    expect(Math.abs(gapInPixels - 8 * dpr)).toBeLessThanOrEqual(1);
  });
});

describe('coverPixels', () => {
  it('fills the frame without distorting the image', () => {
    for (const [frameWidth, frameHeight, ratio] of [
      [520, 350, 1.5],
      [520, 350, 0.667],
      [233, 350, 0.667],
      [1904, 1064, 1.778],
      [700, 455, 1.5],
    ]) {
      const content = coverPixels(frameWidth, frameHeight, ratio);
      expect(Number.isInteger(content.width) && Number.isInteger(content.height)).toBe(true);
      expect(Number.isInteger(content.left) && Number.isInteger(content.top)).toBe(true);
      expect(content.width).toBeGreaterThanOrEqual(frameWidth);
      expect(content.height).toBeGreaterThanOrEqual(frameHeight);
      // One of the two fits exactly, and the frame is covered
      expect(content.width === frameWidth || content.height === frameHeight).toBe(true);
      expect(content.left).toBeLessThanOrEqual(0);
      expect(content.left + content.width).toBeGreaterThanOrEqual(frameWidth);
      expect(content.top + content.height).toBeGreaterThanOrEqual(frameHeight);
      expect(Math.abs(content.width / content.height / ratio - 1)).toBeLessThan(0.01);
    }
  });
});

describe('planScreens', () => {
  const hd = { width: 1920, height: 1080 };
  const plan = (screens: number, images: number) =>
    planScreens(Array(screens).fill(hd), images, 1.2, 'rows', 8);

  it('uses the usual wall of three rows when there are plenty of images', () => {
    expect(plan(1, 500)).toEqual([{ mode: 'wall', laneCount: 3 }]);
    expect(plan(2, 500)).toEqual([
      { mode: 'wall', laneCount: 3 },
      { mode: 'wall', laneCount: 3 },
    ]);
  });

  it('uses fewer, larger rows when a wall of three would show the same images all the time', () => {
    expect(plan(1, 12)).toEqual([{ mode: 'wall', laneCount: 2 }]);
    expect(plan(2, 30)).toEqual([
      { mode: 'wall', laneCount: 2 },
      { mode: 'wall', laneCount: 2 },
    ]);
  });

  it('never plans a wall that has nothing left to move through it', () => {
    for (const screens of [1, 2, 3]) {
      for (let images = 1; images <= 120; images++) {
        const plans = plan(screens, images);
        const shown = plans.reduce(
          (sum, p) =>
            sum +
            (p.mode === 'wall'
              ? estimateWallCount('rows', p.laneCount, hd.width, hd.height, 8, 1.2)
              : p.groupSize),
          0,
        );
        if (plans[0].mode === 'wall') {
          expect(shown * WALL_SPARE_FACTOR).toBeLessThanOrEqual(images);
        } else if (images > screens) {
          // A showcase keeps at least one image aside to change to
          expect(shown).toBeLessThan(images);
        }
      }
    }
  });

  it('shows several images as a showcase, and shares them between the screens', () => {
    expect(plan(2, 5)).toEqual([
      { mode: 'showcase', groupSize: 2 },
      { mode: 'showcase', groupSize: 2 },
    ]);
    expect(plan(2, 3)).toEqual([
      { mode: 'showcase', groupSize: 1 },
      { mode: 'showcase', groupSize: 1 },
    ]);
    expect(plan(2, 1)).toEqual([
      { mode: 'showcase', groupSize: 1 },
      { mode: 'showcase', groupSize: 1 },
    ]);
    expect(plan(1, 8)).toEqual([{ mode: 'showcase', groupSize: 3 }]);
  });
});

describe('layoutShowcase', () => {
  const width = 1920;
  const height = 1080;
  const margin = 40;
  const gap = 16;

  it('shows every image whole, in its own shape, inside the screen', () => {
    for (const ratios of [[1.5], [0.667], [1.5, 0.667, 1.5], [0.667, 0.667, 0.667], [3.2], [0.3]]) {
      const rects = layoutShowcase(ratios, width, height, margin, gap);
      expect(rects.length).toBeGreaterThanOrEqual(1);
      rects.forEach((rect, i) => {
        expect(rect.width / rect.height).toBeCloseTo(ratios[i], 5);
        expect(rect.x).toBeGreaterThanOrEqual(margin - 0.001);
        expect(rect.y).toBeGreaterThanOrEqual(margin - 0.001);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width - margin + 0.001);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height - margin + 0.001);
        if (i > 0) {
          expect(rect.x - (rects[i - 1].x + rects[i - 1].width)).toBeCloseTo(gap, 5);
        }
      });
      // In the middle of the screen
      const left = rects[0].x;
      const right = width - (rects[rects.length - 1].x + rects[rects.length - 1].width);
      expect(left).toBeCloseTo(right, 5);
    }
  });

  it('gives a landscape image the screen to itself, and puts portraits side by side', () => {
    expect(layoutShowcase([1.5, 1.5, 1.5], width, height, margin, gap)).toHaveLength(1);
    expect(layoutShowcase([0.667, 0.667, 0.667], width, height, margin, gap)).toHaveLength(3);
    expect(layoutShowcase([0.667, 0.667], width, height, margin, gap)).toHaveLength(2);
    // As large as the screen allows
    expect(layoutShowcase([1.5], width, height, margin, gap)[0].height).toBeCloseTo(1000, 5);
  });

  it('has nothing to lay out without images', () => {
    expect(layoutShowcase([], width, height, margin, gap)).toEqual([]);
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

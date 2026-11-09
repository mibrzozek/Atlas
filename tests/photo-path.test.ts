import { PathPhoto, photoPath } from '../common/photo-path';
import { Rect } from '../common/workspace';

// 9 wide photos and 6 tall ones, mixed as a library has them
const photos: PathPhoto[] = Array.from({ length: 15 }, (_, i) => ({
  id: `${i}`,
  aspect: i % 5 < 3 ? 1.5 : 2 / 3,
}));
const options = { origin: { x: 0, y: 0 }, rowHeight: 160, aspect: 9 / 16, gap: 10, seed: 1 };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-6 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-6;

describe('a path through photos', () => {
  it('pans along rows of the wide ones and columns of the tall ones in turn, turning at every end', () => {
    const path = photoPath(photos, options);
    // 4 rows of the 9 wide ones around 3 columns of the 6 tall ones: it begins and ends with a row
    expect(path.legs.map((leg) => leg.photos.length)).toEqual([3, 2, 2, 2, 2, 2, 2]);
    expect(path.legs[0].direction).toBe('right');
    path.legs.forEach((leg, i) => {
      const isRow = leg.direction === 'right' || leg.direction === 'left';
      expect(isRow).toBe(i % 2 === 0);
      for (const id of leg.photos) {
        expect(photos.find((p) => p.id === id)!.aspect > 1).toBe(isRow);
      }
    });
    expect(new Set(path.places.keys()).size).toBe(15);
  });

  it('keeps the frame one size, the video shape, against the ends of the legs', () => {
    const path = photoPath(photos, options);
    for (const frame of [path.start, ...path.legs.map((leg) => leg.frame)]) {
      expect(frame.width / frame.height).toBeCloseTo(9 / 16);
      expect(frame.height).toBeCloseTo(path.start.height);
    }
    // The start inside the first photo, each end inside the last photo of its leg
    expect(inside(path.start, path.places.get('0')!)).toBe(true);
    for (const leg of path.legs) {
      const last = path.places.get(leg.photos[leg.photos.length - 1])!;
      const isRow = leg.direction === 'right' || leg.direction === 'left';
      expect(isRow ? inside(leg.frame, last) : overlaps(leg.frame, last)).toBe(true);
    }
  });

  it('hides the photos a leg runs over before it begins, so none that show overlap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const path = photoPath(photos, { ...options, seed });
      const shown = new Map<string, Rect>();
      for (const leg of path.legs) {
        leg.hides.forEach((id) => shown.delete(id));
        for (const id of leg.photos) {
          const place = path.places.get(id)!;
          expect([...shown.values()].filter((other) => overlaps(other, place))).toEqual([]);
          shown.set(id, place);
        }
      }
    }
  });

  it('turns away from what is kept clear when it can', () => {
    // Everything above the first row is kept clear: the first column always goes down
    const avoid = [{ x: -1e4, y: -1e4, width: 2e4, height: 1e4 - 1 }];
    for (let seed = 1; seed <= 20; seed++) {
      const path = photoPath(photos, { ...options, seed, avoid });
      expect(path.legs[1].direction).toBe('down');
    }
  });

  it('loops right, down, left, up over all of them, hiding what it comes back over', () => {
    // 22 wide and 11 tall, as a tag of street photos had them
    const many: PathPhoto[] = Array.from({ length: 33 }, (_, i) => ({
      id: `${i}`,
      aspect: i % 3 === 2 ? 2 / 3 : 1.5,
    }));
    const path = photoPath(many, { ...options, turns: 'loop' });
    expect(path.legs.map((leg) => leg.direction)).toEqual([
      'right',
      'down',
      'left',
      'up',
      'right',
      'down',
      'left',
      'up',
      'right',
      'down',
      'left',
    ]);
    expect(path.legs.flatMap((leg) => leg.photos).sort()).toEqual(many.map((p) => p.id).sort());
    // Rows of the wide ones, columns of the tall ones
    for (const leg of path.legs) {
      const isRow = leg.direction === 'right' || leg.direction === 'left';
      for (const id of leg.photos) {
        expect(many.find((p) => p.id === id)!.aspect > 1).toBe(isRow);
      }
    }
    // It comes round over earlier photos, and none that show overlap
    expect(path.legs.some((leg) => leg.hides.length > 0)).toBe(true);
    const shown = new Map<string, Rect>();
    for (const leg of path.legs) {
      leg.hides.forEach((id) => shown.delete(id));
      for (const id of leg.photos) {
        const place = path.places.get(id)!;
        expect([...shown.values()].filter((other) => overlaps(other, place))).toEqual([]);
        shown.set(id, place);
      }
    }
  });

  it('fills a loop with the other kind when one kind is short', () => {
    // 11 wide, 1 tall: wide ones stacked in the columns too
    const mostlyWide: PathPhoto[] = Array.from({ length: 12 }, (_, i) => ({
      id: `${i}`,
      aspect: i === 0 ? 2 / 3 : 1.5,
    }));
    const path = photoPath(mostlyWide, { ...options, turns: 'loop' });
    expect(path.legs.map((leg) => leg.direction)).toEqual(['right', 'down', 'left', 'up']);
    expect(path.legs.every((leg) => leg.photos.length >= 2)).toBe(true);
    expect(path.legs.flatMap((leg) => leg.photos)).toHaveLength(12);
    // Only tall ones: still the same turns, tall ones side by side in the rows
    const allTall = mostlyWide.map((p) => ({ ...p, aspect: 2 / 3 }));
    const tallPath = photoPath(allTall, { ...options, turns: 'loop' });
    expect(tallPath.legs.map((leg) => leg.direction)).toEqual(['right', 'down', 'left', 'up']);
    expect(tallPath.legs.flatMap((leg) => leg.photos)).toHaveLength(12);
  });

  it('takes all of them in one row when there are too few tall ones for a column', () => {
    const path = photoPath(photos.slice(0, 4), options);
    expect(path.legs).toHaveLength(1);
    expect(path.legs[0].photos).toEqual(['0', '1', '2', '3']);
  });
});

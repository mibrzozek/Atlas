import {
  isMiddleIn,
  motionChanges,
  numbered,
  numberOf,
  Places,
  shotFrame,
  shotSettings,
} from '../src/frontend/director/edits';

// Three photos in a row and a title over them
const places: Places = {
  photos: ['a', 'b', 'c'],
  texts: ['t'],
  at: new Map([
    ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ['b', { x: 120, y: 0, width: 100, height: 100 }],
    ['c', { x: 240, y: 0, width: 100, height: 200 }],
    ['t', { x: 0, y: -80, width: 340, height: 60 }],
  ]),
};
const tall = 9 / 16;
const start = { x: 0, y: 0, width: 90, height: 160 };

describe('the Director edits', () => {
  it('fills the shot with a photo, or shows all of it with room', () => {
    const filled = shotFrame(start, tall, { photo: 2 }, places);
    // A square photo in a tall frame: as high as the photo, its middle on the photo's
    expect(filled.height).toBeCloseTo(103);
    expect(filled.x + filled.width / 2).toBeCloseTo(170);
    expect(filled.width / filled.height).toBeCloseTo(tall);
    const whole = shotFrame(start, tall, { photo: 2, room: 0.1 }, places);
    expect(whole.width).toBeCloseTo(120);
    expect(isMiddleIn(places.at.get('b')!, whole)).toBe(true);
  });

  it('fills the shot with a photo against its start or end, to pan over all of it', () => {
    // Wider than the frame: against its left and right edges, with the room it has above and below
    const left = shotFrame(start, tall, { photo: 2, align: 'start' }, places);
    expect(left.x).toBeCloseTo(118.5);
    const right = shotFrame(start, tall, { photo: 2, align: 'end' }, places);
    expect(right.x + right.width).toBeCloseTo(221.5);
    expect([right.y, right.height]).toEqual([left.y, left.height]);
    // Taller than the frame: against its top and bottom
    const top = shotFrame(start, tall, { photo: 3, align: 'start' }, places);
    expect(top.y).toBeCloseTo(-1.5);
    const bottom = shotFrame(start, tall, { photo: 3, align: 'end' }, places);
    expect(bottom.y + bottom.height).toBeCloseTo(201.5);
    expect(bottom.x).toBeCloseTo(top.x);
    expect(() => shotFrame(start, tall, { all: true, align: 'start' }, places)).toThrow('align');
    expect(() => shotFrame(start, tall, { photo: 2, room: 0, align: 'end' }, places)).toThrow(
      'align',
    );
    expect(() => shotFrame(start, tall, { photo: 2, align: 'left' }, places)).toThrow('align');
  });

  it('frames photos, the title or everything, then zooms and moves', () => {
    const title = shotFrame(start, tall, { title: true, room: 0 }, places);
    expect(title.width).toBeCloseTo(340);
    const all = shotFrame(start, tall, { all: true, room: 0 }, places);
    expect(all.width).toBeCloseTo(340);
    const zoomed = shotFrame(start, tall, { zoom: 2 }, places);
    expect(zoomed).toEqual({ x: 22.5, y: 40, width: 45, height: 80 });
    const moved = shotFrame(start, tall, { move: [0.5, -1] }, places);
    expect(moved).toEqual({ x: 45, y: -160, width: 90, height: 160 });
  });

  it('refuses what makes no sense, before anything changes', () => {
    expect(() => shotFrame(start, tall, { photo: 4 }, places)).toThrow('photo');
    expect(() => shotFrame(start, tall, { photo: 1, all: true }, places)).toThrow('one of');
    expect(() => shotFrame(start, tall, { zoom: NaN }, places)).toThrow('zoom');
    expect(() => shotSettings({ arrival: 'teleport' })).toThrow('arrival');
    expect(() => motionChanges({ kind: 'explode' }, places)).toThrow('No such motion');
    expect(() => motionChanges({ strength: 'abc' as unknown as number }, places)).toThrow(
      'strength',
    );
    expect(() => numberOf(true, 'n', 0, 1)).toThrow();
    expect(() => numbered([], 1, 'shot')).toThrow('no shots');
  });

  it('turns photo numbers into the photos, and leaves out what is not changed', () => {
    expect(motionChanges({ photos: [3, 1, 3], strength: 2 }, places)).toEqual({
      targets: ['c', 'a'],
      strength: 2,
    });
    expect(motionChanges({ photos: 'all' }, places)).toEqual({ targets: ['a', 'b', 'c'] });
    expect(shotSettings({ stay: 'drift' })).toEqual({ stay: 'drift' });
  });
});

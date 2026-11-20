import { CameraStop } from '../common/video';
import {
  cutMoments,
  isMiddleIn,
  isTextCutOff,
  motionChanges,
  numbered,
  numberOf,
  Places,
  ShotFacts,
  shotFrame,
  shotSettings,
  timelineWarnings,
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

  it('shows the last moment of a shot and the arrival of the next at each cut', () => {
    // Shots of 2 s, 3 s and 1 s at 10 frames a second: shot 2 glides in over 1.2 s, shot 3 over 2 s (capped)
    const camera = [stop('a', 2, 'glide'), stop('b', 3, 'glide'), stop('c', 1, 'glide', 2)];
    const moments = cutMoments(camera, 10, 6, 1);
    expect(moments.map((m) => m.label)).toEqual(['start', '1|2', '1|2', '2|3', '2|3', 'end']);
    expect(moments[0].time).toBe(0);
    expect(moments[1].time).toBeCloseTo(1.9);
    expect(moments[2].time).toBeCloseTo(3.2);
    expect(moments[3].time).toBeCloseTo(4.9);
    expect(moments[4].time).toBeCloseTo(5.9);
    expect(moments[5].time).toBeCloseTo(5.9);
  });

  it('pages through the cuts, a cut at a time from the shot given, at most 32 moments', () => {
    const camera = [...Array(40).keys()].map((i) => stop(`s${i}`, 1, 'cut'));
    expect(cutMoments(camera, 10, 40, 1).length).toBe(31);
    const page = cutMoments(camera, 10, 40, 16);
    expect(page.map((m) => m.label).slice(0, 2)).toEqual(['16|17', '16|17']);
    expect(page.length).toBe(30);
    const last = cutMoments(camera, 10, 40, 26);
    expect(last.map((m) => m.label).slice(-1)).toEqual(['end']);
    expect(last.length).toBe(29);
    expect(cutMoments([stop('only', 2, 'cut')], 10, 2, 1).map((m) => m.label)).toEqual([
      'start',
      'end',
    ]);
    expect([1, 16, 26].every((from) => cutMoments(camera, 10, 40, from).length <= 32)).toBe(true);
  });

  it('finds the text cut off by a frame: reaching into it, and not all in it', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100 };
    expect(isTextCutOff({ x: 10, y: 10, width: 20, height: 20 }, frame)).toBe(false);
    expect(isTextCutOff({ x: 90, y: 10, width: 20, height: 20 }, frame)).toBe(true);
    expect(isTextCutOff({ x: 100, y: 10, width: 20, height: 20 }, frame)).toBe(false);
    expect(isTextCutOff({ x: 200, y: 10, width: 20, height: 20 }, frame)).toBe(false);
  });

  it('warns about the weak spots of a timeline, by shot', () => {
    const shot = (n: number, facts: Partial<ShotFacts> = {}): ShotFacts => ({
      n,
      length: 2,
      shows: [n],
      showsText: false,
      textsCutOff: false,
      ...facts,
    });
    expect(timelineWarnings([shot(1, { length: 0.4 })], 0.43)).toEqual([
      'Shot 1: shorter than one beat (0.40 s < 0.43 s)',
    ]);
    expect(timelineWarnings([shot(1, { length: 0.4 })])).toEqual([]);
    expect(
      timelineWarnings([
        shot(1, { shows: [7] }),
        shot(2),
        shot(3, { shows: [7] }),
        shot(4, { shows: [7, 8] }),
      ]),
    ).toEqual(['Shot 3: repeats photo 7 of shot 1']);
    expect(timelineWarnings([shot(1, { textsCutOff: true })])).toEqual([
      'Shot 1: a title or text is cut off by its frame',
    ]);
    expect(timelineWarnings([shot(1, { shows: [] })])).toEqual(['Shot 1: opens on nothing']);
    expect(timelineWarnings([shot(1, { shows: [], showsText: true })])).toEqual([]);
    const quick = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
      shot(n, { length: n >= 4 && n <= 9 ? 1 : 3 }),
    );
    expect(timelineWarnings(quick)).toEqual(['Shot 4: no shot holds from shot 4 to 9']);
    const four = [1, 2, 3, 4, 5].map((n) => shot(n, { length: n >= 2 && n <= 5 ? 1 : 3 }));
    expect(timelineWarnings(four)).toEqual([]);
  });
});

/** A shot of `length` seconds that glides in over `arrivalTime` seconds */
function stop(
  id: string,
  length: number,
  arrival: CameraStop['arrival'],
  arrivalTime = 1.2,
): CameraStop {
  return {
    id,
    length,
    frame: { x: 0, y: 0, width: 90, height: 160 },
    arrival,
    arrivalTime,
    stay: 'still',
    easing: 'smooth',
  };
}

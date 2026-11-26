import { CameraStop } from '../common/video';
import {
  cutMoments,
  frameOnSubject,
  isBridgeShot,
  isMiddleIn,
  isTextCutOff,
  motionChanges,
  numbered,
  numberOf,
  parseBatchSteps,
  pixelDiff,
  Places,
  seamPairs,
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
      subjectOutside: false,
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
    expect(timelineWarnings([shot(1, { shows: [7], subjectOutside: true })])).toEqual([
      expect.stringMatching(/^Shot 1: photo 7.s subject is outside the frame$/),
    ]);
    expect(timelineWarnings([shot(1, { shows: [7, 8], subjectOutside: true })])).toEqual([]);
  });

  it('frames a photo on its subject, as near the middle as the photo allows', () => {
    // A tall frame filled by a square photo: it can move along the photo's width, not its height
    const area = { x: 0, y: 0, width: 100, height: 100 };
    const centred = frameOnSubject(area, tall, { x: 50, y: 50 });
    expect(centred.x + centred.width / 2).toBeCloseTo(50);
    expect(centred.y).toBeCloseTo(-1.5);
    // Near its left or right edge the frame stays on the photo
    expect(frameOnSubject(area, tall, { x: 5, y: 50 }).x).toBeCloseTo(0);
    const right = frameOnSubject(area, tall, { x: 95, y: 50 });
    expect(right.x + right.width).toBeCloseTo(100);
    // Taller than the photo, it covers the photo and no more: as far up as it can go, its bottom on the photo's
    expect(frameOnSubject(area, tall, { x: 50, y: 5 }).y).toBeCloseTo(-3);
  });

  it('frames a photo on its subject, zooms around it, and leaves the other framings alone', () => {
    const subjects = new Map([['b', { x: 130, y: 50 }]]);
    const withSubject = { ...places, subjects };
    const framed = shotFrame(start, tall, { photo: 2 }, withSubject);
    // The subject sits left of the photo's middle: the frame is as far left as the photo lets it be
    expect(framed.x).toBeCloseTo(120);
    // Zoomed around the subject: it keeps its place in the frame
    const zoomed = shotFrame(start, tall, { photo: 2, zoom: 2 }, withSubject);
    expect(zoomed.width).toBeCloseTo(framed.width / 2);
    expect((130 - zoomed.x) / zoomed.width).toBeCloseTo((130 - framed.x) / framed.width);
    // Not framed on the subject with room, or an alignment, or a photo without one
    expect(shotFrame(start, tall, { photo: 2, room: 0.1 }, withSubject)).toEqual(
      shotFrame(start, tall, { photo: 2, room: 0.1 }, places),
    );
    expect(shotFrame(start, tall, { photo: 2, align: 'start' }, withSubject)).toEqual(
      shotFrame(start, tall, { photo: 2, align: 'start' }, places),
    );
    expect(shotFrame(start, tall, { photo: 1 }, withSubject)).toEqual(
      shotFrame(start, tall, { photo: 1 }, places),
    );
  });

  it('parses batch steps in tuple or object form and rejects nested or main-process commands', () => {
    expect(
      parseBatchSteps([
        ['subject', 'ws1', 1, 0.5, 0.5],
        { method: 'setVideo', args: ['ws1', { fps: 30 }] },
        { method: 'ready' },
      ]),
    ).toEqual([
      { method: 'subject', args: ['ws1', 1, 0.5, 0.5] },
      { method: 'setVideo', args: ['ws1', { fps: 30 }] },
      { method: 'ready', args: [] },
    ]);
    expect(() => parseBatchSteps([])).toThrow('non-empty');
    expect(() => parseBatchSteps([['batch', []]])).toThrow('not inside batch');
    expect(() => parseBatchSteps([['save', 'ws1', 'phone']])).toThrow('not inside batch');
    expect(() => parseBatchSteps([['music', 'ws1', 'song.mp3']])).toThrow('not inside batch');
    expect(() => parseBatchSteps([123])).toThrow('Step 1');
  });

  it('identifies relay bridges, suppresses beat noise for them, and pairs cut/loop seams', () => {
    const bridge: CameraStop = {
      ...stop('b1', 0.12, 'cut'),
      stay: 'pull-out',
      easing: 'linear',
    };
    const normalCut = stop('c1', 2, 'cut');
    const scroll = stop('s1', 2.4, 'scroll');
    expect(isBridgeShot(bridge)).toBe(true);
    expect(isBridgeShot(normalCut)).toBe(false);
    expect(isBridgeShot(scroll)).toBe(false);

    // Bridge shots do not emit "shorter than one beat" or quick-run warnings
    expect(
      timelineWarnings(
        [
          {
            n: 1,
            length: 0.12,
            shows: [1],
            showsText: false,
            textsCutOff: false,
            subjectOutside: false,
            isBridge: true,
          },
        ],
        0.52,
      ),
    ).toEqual([]);

    const pairs = seamPairs([bridge, scroll, bridge, scroll], 5.04, true);
    expect(pairs.map((p) => p.label)).toEqual(['2|3', 'end|start']);
    expect(pairs[0].after).toBeCloseTo(2.52);
    expect(pairs[0].before).toBeLessThan(pairs[0].after);
    expect(pairs[1].after).toBe(0);
    expect(pairs[1].before).toBeCloseTo(5.04, 3);

    const a = new Uint8ClampedArray([10, 20, 30, 255, 100, 110, 120, 255]);
    const b = new Uint8ClampedArray([10, 21, 30, 255, 100, 110, 121, 255]);
    const pop = new Uint8ClampedArray([250, 250, 250, 255, 0, 0, 0, 255]);
    expect(pixelDiff(a, b)).toEqual({ rmse: 0.58, maxDelta: 1, seamless: true });
    expect(pixelDiff(a, pop).seamless).toBe(false);
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

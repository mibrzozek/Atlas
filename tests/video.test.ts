import {
  blockAt,
  CameraStop,
  cameraAt,
  closestFrameWidth,
  ease,
  endOf,
  followLayout,
  followLockedLayers,
  frameCount,
  frameIn,
  frameInShape,
  LayoutBlock,
  moveInRow,
  MUSIC_BITRATE,
  newVideo,
  outputSize,
  nextShotFrame,
  posesOf,
  predictedLayerForShot,
  resizeVideo,
  rowsOf,
  shotBefore,
  snapTime,
  SoundEffect,
  soundPlayback,
  soundsByTime,
  startsOf,
  stateAt,
  VIDEO_FORMATS,
  videoBeats,
  videoBitrate,
  videoFromRow,
  videoLength,
  VideoProject,
  videoSize,
  withEnd,
  withLength,
} from '../common/video';
import { Motion, motionAt, wavesAt } from '../common/video-motion';
import { WorkspaceImageItem } from '../common/workspace';

const image = (id: string, x: number, width = 100): WorkspaceImageItem => ({
  kind: 'image',
  id,
  fileId: id,
  imageAspect: 1,
  x,
  y: 0,
  width,
  height: width,
  z: 0,
});

const view = { x: 0, y: 0, width: 1000, height: 1000 };
const frameAt = (x: number, width = 100) => ({ x, y: 0, width, height: width });

const stop = (
  id: string,
  frame: CameraStop['frame'],
  length: number,
  rest: Partial<CameraStop> = {},
): CameraStop => ({
  id,
  frame,
  length,
  arrival: 'glide',
  arrivalTime: 1,
  stay: 'still',
  easing: 'linear',
  ...rest,
});

const layout = (
  id: string,
  poses: LayoutBlock['poses'],
  length: number,
  transition = 1,
): LayoutBlock => ({
  id,
  poses,
  length,
  transition,
  easing: 'linear',
});

const motion = (
  kind: Motion['kind'],
  targets: string[],
  start: number,
  length: number,
  rest: Partial<Motion> = {},
): Motion => ({
  id: kind,
  kind,
  targets,
  start,
  length,
  strength: 1,
  speed: 1,
  stagger: 0,
  ...rest,
});

describe('video formats', () => {
  it('are even, and within what the encoder takes', () => {
    for (const format of VIDEO_FORMATS) {
      expect(videoSize(format.width, format.height)).toEqual({
        width: format.width,
        height: format.height,
      });
    }
    expect(videoSize(1001, 777)).toEqual({ width: 1000, height: 776 });
    const large = videoSize(3840, 2160);
    expect(Math.ceil(large.width / 16) * Math.ceil(large.height / 16)).toBeLessThanOrEqual(8192);
    expect(large.width / large.height).toBeCloseTo(16 / 9, 1);
    expect(videoSize(0, -5)).toEqual({ width: 16, height: 16 });
  });

  it('have a frame of their shape, in what is shown or around the same middle', () => {
    expect(frameIn(view, 9 / 16)).toEqual({ x: 218.75, y: 0, width: 562.5, height: 1000 });
    expect(frameInShape({ x: 0, y: 0, width: 400, height: 100 }, 1)).toEqual({
      x: 100,
      y: -50,
      width: 200,
      height: 200,
    });
    const video = { ...newVideo(view), camera: [stop('a', frameIn(view, 9 / 16), 4)] };
    const square = resizeVideo(video, { width: 1080, height: 1080 });
    expect(square.camera[0].frame.width).toBeCloseTo(square.camera[0].frame.height);
  });
});

describe('blocks in a row', () => {
  const row = [stop('a', view, 2), stop('b', view, 3), stop('c', view, 1)];

  it('follow one another from the start', () => {
    expect(startsOf(row)).toEqual([0, 2, 5]);
    expect(endOf(row)).toBe(6);
    expect([blockAt(row, 0), blockAt(row, 2.5), blockAt(row, 99), blockAt([], 1)]).toEqual([
      0, 1, 2, -1,
    ]);
  });

  it('are stretched by their edge and moved, keeping their length', () => {
    expect(withLength(row, 'b', 4.567).map((b) => b.length)).toEqual([2, 4.57, 1]);
    expect(withLength(row, 'b', -1)[1].length).toBe(0.1);
    const moved = moveInRow(row, 'c', 0);
    expect(moved.map((b) => `${b.id}${b.length}`)).toEqual(['c1', 'a2', 'b3']);
  });

  it('end the video at the end marker: on the end of the camera until it is put elsewhere', () => {
    const video: VideoProject = {
      ...newVideo(view),
      camera: row,
      motions: [motion('jiggle', ['a'], 5, 4)],
    };
    expect(videoLength(video)).toBe(6);
    expect(frameCount(video)).toBe(180);
    expect(videoLength({ ...video, camera: withLength(row, 'c', 2) })).toBe(7);

    const placed = withEnd(video, 9.004);
    expect(videoLength(placed)).toBe(9);
    expect(frameCount(placed)).toBe(270);
    expect(videoLength({ ...placed, camera: withLength(row, 'c', 2) })).toBe(9);
    expect(videoLength(withEnd(video, -3))).toBe(0.1);
    expect(videoLength(withEnd(placed, undefined))).toBe(6);
    expect(videoFromRow(JSON.parse(JSON.stringify(placed)))?.end).toBe(9);
  });

  it('put a new shot beside the one chosen (or the last), as large; the first on the frame', () => {
    const video = newVideo(view);
    expect(nextShotFrame(video)).toEqual(video.frame);
    const a = { ...stop('a', frameAt(0), 2), frame: { x: 0, y: 50, width: 100, height: 200 } };
    const b = { ...stop('b', frameAt(0), 2), frame: { x: 500, y: 0, width: 50, height: 100 } };
    const two = { ...video, camera: [a, b] };
    expect(nextShotFrame(two)).toEqual({ x: 554, y: 0, width: 50, height: 100 });
    expect(nextShotFrame(two, 'a')).toEqual({ x: 108, y: 50, width: 100, height: 200 });
  });

  it('save at phone size: the shape kept, the long side 1280, the whole file within 30 MB', () => {
    expect(outputSize({ width: 1080, height: 1920 }, 'phone')).toEqual({
      width: 720,
      height: 1280,
    });
    expect(outputSize({ width: 1920, height: 1080 }, 'phone')).toEqual({
      width: 1280,
      height: 720,
    });
    expect(outputSize({ width: 1080, height: 1080 }, 'phone')).toEqual({
      width: 1080,
      height: 1080,
    });
    expect(outputSize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
    const phone = { width: 720, height: 1280 };
    // What 30 s, 60 s and a 60 fps 30 s video come to, picture and music: never over the limit
    const megabytes = (fps: number, length: number) =>
      ((videoBitrate(phone, fps, length, 'phone') + MUSIC_BITRATE) * length) / 8 / 1024 / 1024;
    expect(megabytes(30, 30)).toBeLessThan(26.1);
    expect(megabytes(60, 30)).toBeLessThan(26.1);
    expect(megabytes(30, 60)).toBeLessThan(26.1);
    // A short one keeps the clean bitrate of full size
    expect(videoBitrate(phone, 30, 5, 'phone')).toBe(videoBitrate(phone, 30, 5, 'full'));
  });

  it('supports tier-2 phone-full export at full 1080p reel size with uncapped bitrate', () => {
    expect(outputSize({ width: 1080, height: 1920 }, 'phone-full')).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(outputSize({ width: 1920, height: 1080 }, 'phone-full')).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(outputSize({ width: 1080, height: 1350 }, 'phone-full')).toEqual({
      width: 1080,
      height: 1350,
    });
    // Uncapped clean bitrate even on long 60s / 60fps reels
    const reel = { width: 1080, height: 1920 };
    expect(videoBitrate(reel, 30, 60, 'phone-full')).toBe(videoBitrate(reel, 30, 60, 'full'));
    expect(videoBitrate(reel, 60, 60, 'phone-full')).toBe(videoBitrate(reel, 60, 60, 'full'));
    expect(videoBitrate(reel, 30, 60, 'phone-full')).toBeGreaterThan(
      videoBitrate({ width: 720, height: 1280 }, 30, 60, 'phone'),
    );
  });

  it('skips hidden layers when predicting the majority layer for a shot', () => {
    const visible = {
      id: 'visible',
      kind: 'image' as const,
      fileId: 'f1',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      z: 1,
      imageAspect: 1,
    };
    const hiddenTop = {
      id: 'hidden',
      kind: 'image' as const,
      fileId: 'f2',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      z: 5,
      imageAspect: 1,
      isHidden: true,
    };
    expect(
      predictedLayerForShot({ x: 10, y: 10, width: 100, height: 100 }, [visible, hiddenTop])?.id,
    ).toBe('visible');
  });

  it('know the shot before one, where the camera comes from', () => {
    const video = {
      ...newVideo(view),
      camera: [stop('a', frameAt(0), 2), stop('b', frameAt(0), 2)],
    };
    expect(shotBefore(video, 'b')?.id).toBe('a');
    expect(shotBefore(video, 'a')).toBeUndefined();
    expect(shotBefore(video, undefined)).toBeUndefined();
  });

  it('know how close the camera comes: its stops, pushed in where they push', () => {
    const video = newVideo(view);
    expect(closestFrameWidth(video)).toBe(video.frame.width);
    const wide = { ...stop('a', frameAt(0), 2), frame: { x: 0, y: 0, width: 400, height: 400 } };
    const close = { ...stop('b', frameAt(0), 2), frame: { x: 0, y: 0, width: 200, height: 200 } };
    // The frame of the workspace does not count once there are stops
    expect(
      closestFrameWidth({ ...video, frame: { x: 0, y: 0, width: 10, height: 10 }, camera: [wide] }),
    ).toBe(400);
    expect(closestFrameWidth({ ...video, camera: [wide, close] })).toBe(200);
    expect(closestFrameWidth({ ...video, camera: [wide, { ...close, stay: 'push-in' }] })).toBe(
      170,
    );
  });

  it('end without a camera where the last layout or motion ends', () => {
    const video = { ...newVideo(view), motions: [motion('jiggle', ['a'], 5, 4)] };
    expect(videoLength(video)).toBe(9);
  });
});

describe('the camera', () => {
  const a = frameAt(0);
  const b = frameAt(400, 400);

  it('stays on the frame of the workspace without stops, and on the first stop at the start', () => {
    const empty = newVideo(view);
    expect(cameraAt(empty, 3)).toEqual(empty.frame);
    expect(cameraAt({ ...empty, camera: [stop('a', a, 2)] }, 0.5)).toEqual(a);
  });

  it('glides to the next stop, zooming evenly, then rests', () => {
    const video = {
      ...newVideo(view),
      camera: [stop('a', a, 2), stop('b', b, 3, { arrivalTime: 2 })],
    };
    const half = cameraAt(video, 3);
    // Half way from 100 to 400 wide, the size changing by the same factor in each step: 200
    expect(half.width).toBeCloseTo(200);
    expect(half.x + half.width / 2).toBeCloseTo((50 + 600) / 2);
    expect(cameraAt(video, 4.5)).toEqual(b);
  });

  it('cuts at once, scrolls over the whole stop, and whips quickly', () => {
    const cut = {
      ...newVideo(view),
      camera: [stop('a', a, 2), stop('b', b, 3, { arrival: 'cut' })],
    };
    expect(cameraAt(cut, 2.01)).toEqual(b);
    const scroll = {
      ...newVideo(view),
      camera: [stop('a', a, 2), stop('b', frameAt(400), 4, { arrival: 'scroll' })],
    };
    expect(cameraAt(scroll, 4).x).toBeCloseTo(200);
    const whip = {
      ...newVideo(view),
      camera: [stop('a', a, 2), stop('b', b, 3, { arrival: 'whip', arrivalTime: 2 })],
    };
    expect(cameraAt(whip, 2.4)).toEqual(b);
  });

  it('pushes in and pulls out while it stays, and drifts a little', () => {
    const push = {
      ...newVideo(view),
      camera: [stop('a', frameAt(0, 100), 4, { stay: 'push-in' })],
    };
    expect(cameraAt(push, 0).width).toBeCloseTo(100);
    expect(cameraAt(push, 4).width).toBeCloseTo(85);
    const pull = {
      ...newVideo(view),
      camera: [stop('a', frameAt(0, 100), 4, { stay: 'pull-out' })],
    };
    expect(cameraAt(pull, 0).width).toBeCloseTo(85);
    expect(cameraAt(pull, 4).width).toBeCloseTo(100);
    const drift = {
      ...newVideo(view),
      camera: [stop('a', frameAt(0, 100), 10, { stay: 'drift' })],
    };
    const moments = [1, 2, 3].map((t) => cameraAt(drift, t));
    expect(new Set(moments.map((m) => m.x.toFixed(3))).size).toBe(3);
    moments.forEach((m) => expect(Math.abs(m.x - 1.5)).toBeLessThan(4));
  });
});

describe('the layout', () => {
  const items = [image('a', 0), image('b', 200)];
  const first = posesOf(items);
  const moved = posesOf([image('a', 100, 200), image('c', 400)]);

  it('is the workspace as it is when the lane is empty', () => {
    const state = stateAt(newVideo(view), items, 3);
    expect([...state.objects.keys()]).toEqual(['a', 'b']);
    expect(state.objects.get('b')).toMatchObject({ x: 200, opacity: 1, scale: 1 });
  });

  it('glides from one arrangement to the next: moved, faded in, faded out', () => {
    const video = {
      ...newVideo(view),
      layouts: [layout('one', first, 2), layout('two', moved, 3, 2)],
    };
    const half = stateAt(video, items, 3);
    expect(half.objects.get('a')).toMatchObject({ x: 50, width: 150, opacity: 1 });
    expect(half.objects.get('b')).toMatchObject({ x: 200, opacity: 0.5 });
    expect(half.objects.get('c')).toMatchObject({ x: 400, opacity: 0.5 });
    expect(stateAt(video, items, 4.5).objects.has('b')).toBe(false);
  });

  it('follows the workspace while it is shown: what is in it and what is new', () => {
    const video = {
      ...newVideo(view),
      layouts: [layout('one', posesOf([items[0]]), 2), layout('two', first, 2)],
    };
    const followed = followLayout(video, 'one', [image('a', 50), items[1], image('new', 400)]);
    expect(Object.keys(followed.layouts[0].poses).sort()).toEqual(['a', 'new']);
    expect(followed.layouts[1]).toBe(video.layouts[1]);
  });
});

describe('motions', () => {
  it('bring an object in at their start, and it is not seen before', () => {
    const pop = [motion('pop-in', ['a'], 2, 3)];
    expect(motionAt(pop, 'a', 1).opacity).toBe(0);
    expect(motionAt(pop, 'a', 2.1).scale).toBeLessThan(1);
    expect(motionAt(pop, 'a', 4)).toMatchObject({ scale: 1, opacity: 1 });
    expect(motionAt(pop, 'b', 1).opacity).toBe(1);
  });

  it('take an object out at their end, and it is not seen after', () => {
    const fade = [motion('fade-out', ['a'], 0, 3)];
    expect(motionAt(fade, 'a', 1).opacity).toBe(1);
    expect(motionAt(fade, 'a', 2.8).opacity).toBeLessThan(1);
    expect(motionAt(fade, 'a', 3.5).opacity).toBe(0);
  });

  it('hide an object for a while, softly, and it is seen before and after', () => {
    const hide = [motion('hide', ['a'], 2, 3)];
    expect(motionAt(hide, 'a', 1).opacity).toBe(1);
    expect(motionAt(hide, 'a', 2.05).opacity).toBeGreaterThan(0);
    expect(motionAt(hide, 'a', 3).opacity).toBe(0);
    expect(motionAt(hide, 'a', 6).opacity).toBe(1);
  });

  it('move an object all through, starting and stopping softly, one after another with a stagger', () => {
    const jiggle = [motion('jiggle', ['a', 'b'], 1, 4, { stagger: 0.5 })];
    expect(motionAt(jiggle, 'a', 0.5).rotation).toBe(0);
    expect(Math.abs(motionAt(jiggle, 'a', 1.01).rotation)).toBeLessThan(0.5);
    const some = [1.3, 1.6, 2.2, 2.9].map((t) => Math.abs(motionAt(jiggle, 'a', t).rotation));
    expect(Math.max(...some)).toBeGreaterThan(1);
    // b begins half a second later
    expect(motionAt(jiggle, 'b', 1.3).rotation).toBe(0);
    expect(motionAt(jiggle, 'a', 6).rotation).toBe(0);
  });

  it('pulse on the beats of the music', () => {
    const pulse = [motion('pulse', ['a'], 0, 10)];
    const beats = [1, 2, 3];
    expect(motionAt(pulse, 'a', 2.01, beats).scale).toBeGreaterThan(1.05);
    expect(motionAt(pulse, 'a', 2.6, beats).scale).toBeLessThan(1.01);
  });

  it('roll a wave through objects: its crest under the middle one at the swell, then they settle', () => {
    let ids = 0;
    const targets = ['a', 'b', 'c', 'd', 'e'];
    const [wave] = wavesAt([10], targets, () => `w${ids++}`);
    const lift = (id: string, t: number) => -motionAt([wave], id, t).dy;
    // The middle one is highest at the swell, the first earlier, the last later
    const highest = (id: string) =>
      Array.from({ length: 300 }, (_, i) => 7 + i / 50).reduce((best, t) =>
        lift(id, t) > lift(id, best) ? t : best,
      );
    expect(Math.abs(highest('c') - 10)).toBeLessThan(0.15);
    expect(highest('a')).toBeLessThan(highest('c'));
    expect(highest('e')).toBeGreaterThan(highest('c'));
    expect(lift('c', 10)).toBeGreaterThan(0.1);
    // Still before it, at rest long after
    expect(lift('c', 7)).toBeCloseTo(0, 10);
    expect(Math.abs(lift('c', 16))).toBeLessThan(0.01);
    // A swell too early to reach the middle in time makes no wave
    expect(wavesAt([0.5], targets, () => 'x')).toEqual([]);
  });
});

describe('the music', () => {
  const music = {
    path: 'song.mp3',
    name: 'song',
    start: 2,
    trim: 1,
    duration: 30,
    volume: 1,
    bpm: 120,
    beats: [0.5, 1, 1.5, 2],
  };

  it('puts its beats on the video where they are heard', () => {
    expect(videoBeats({ ...newVideo(view), music })).toEqual([2, 2.5, 3]);
  });

  it('snaps a time to the nearest mark close enough', () => {
    expect(snapTime(2.1, [2, 2.5], 0.2)).toBe(2);
    expect(snapTime(2.3, [2, 2.5], 0.1)).toBe(2.3);
    expect(snapTime(2.26, [2, 2.5], 0.3)).toBe(2.5);
  });
});

describe('the sound effects', () => {
  const sound = (at: number, duration: number): SoundEffect => ({
    id: `s${at}`,
    path: 'sfx/a.mp3',
    name: 'a',
    at,
    volume: 1,
    duration,
  });

  it('are numbered in the order they start, the order they were added kept', () => {
    const video = { ...newVideo(view), sounds: [sound(5, 1), sound(2, 1)] };
    expect(soundsByTime(video).map((s) => s.at)).toEqual([2, 5]);
    expect(video.sounds!.map((s) => s.at)).toEqual([5, 2]);
    expect(soundsByTime(newVideo(view))).toEqual([]);
  });

  it('play from their start, or from where the video is in them, cut where the video ends', () => {
    expect(soundPlayback(sound(2, 3), 0, 10)).toEqual({ wait: 2, offset: 0, span: 3 });
    expect(soundPlayback(sound(2, 3), 3, 10)).toEqual({ wait: 0, offset: 1, span: 2 });
    expect(soundPlayback(sound(2, 3), 0, 4)).toEqual({ wait: 2, offset: 0, span: 2 });
    expect(soundPlayback(sound(2, 3), 5, 10)).toBeUndefined();
    expect(soundPlayback(sound(12, 3), 0, 10)).toBeUndefined();
  });
});

describe('blocks in rows', () => {
  const block = (id: string, start: number, length: number) => ({ id, start, length });
  const rows = (blocks: { id: string; start: number; length: number }[]) =>
    rowsOf(blocks, (b) => b);

  it('puts blocks that overlap in rows of their own, and touching ones in the same row', () => {
    const packed = rows([
      block('a', 0, 2),
      block('b', 1, 2),
      block('c', 2, 1),
      block('d', 1.5, 0.2),
    ]);
    expect(packed.count).toBe(3);
    expect(Object.fromEntries(packed.rowOf)).toEqual({ a: 0, b: 1, c: 0, d: 2 });
  });

  it('has no rows when there are no blocks', () => {
    expect(rows([])).toEqual({ rowOf: new Map(), count: 0 });
  });
});

describe('storage', () => {
  it('reads a video back as it was stored, and refuses what is not one', () => {
    const video: VideoProject = {
      ...newVideo(view),
      camera: [stop('a', frameAt(0), 2, { stay: 'drift' })],
      layouts: [layout('l', posesOf([image('a', 0)]), 2)],
      motions: [motion('float', ['a'], 0, 2), motion('wave', ['a'], 1, 5)],
      music: {
        path: 'sea.mp3',
        name: 'sea',
        start: 0,
        trim: 0,
        duration: 60,
        volume: 1,
        bpm: 0,
        beats: [],
        swells: [3, 9.5],
      },
    };
    expect(videoFromRow(JSON.parse(JSON.stringify(video)))).toEqual(video);
    expect(videoFromRow(undefined)).toBeUndefined();
    expect(videoFromRow({ width: 'x' })).toBeUndefined();
    const damaged = videoFromRow({ ...video, fps: 25, motions: [{ id: 'x', kind: 'nope' }] })!;
    expect([damaged.fps, damaged.motions.length]).toEqual([30, 0]);
  });

  it('reads the sound effects back, leaving out those that are damaged', () => {
    const sound = {
      id: 'bang',
      path: 'sfx/bang.mp3',
      name: 'bang',
      at: 4,
      volume: 1.2,
      duration: 2,
    };
    const video: VideoProject = { ...newVideo(view), sounds: [sound] };
    expect(videoFromRow(JSON.parse(JSON.stringify(video)))).toEqual(video);
    const read = videoFromRow({
      ...video,
      sounds: [
        { ...sound, id: 'loud', volume: 9 },
        { ...sound, id: 'quiet', volume: -1, at: -2 },
        { ...sound, id: 'nowhere', path: 42 },
        { ...sound, id: 'endless', duration: Infinity },
        { ...sound, id: 'late', at: NaN },
        { ...sound, id: 'silent', duration: 0 },
        { path: 'sfx/no-id.mp3', at: 1, duration: 1 },
        'nothing',
      ],
    })!;
    expect(read.sounds).toEqual([
      { ...sound, id: 'loud', volume: 1.5 },
      { ...sound, id: 'quiet', volume: 0, at: 0 },
    ]);
    expect(videoFromRow({ ...video, sounds: 'many' })!.sounds).toBeUndefined();
    expect(videoFromRow({ ...video, sounds: undefined })!.sounds).toBeUndefined();
    expect(
      videoFromRow({ ...video, sounds: [{ ...sound, volume: undefined }] })!.sounds![0].volume,
    ).toBe(0.35);
  });

  it('turns the shots of the first version into camera stops and layouts', () => {
    const old = {
      width: 1080,
      height: 1920,
      fps: 30,
      background: '#000',
      shots: [
        {
          id: 's1',
          frame: frameAt(0),
          poses: posesOf([image('a', 0)]),
          duration: 1,
          hold: 3,
          easing: 'smooth',
        },
        {
          id: 's2',
          frame: frameAt(300),
          poses: posesOf([image('a', 50)]),
          duration: 1,
          hold: 2,
          easing: 'smooth',
        },
      ],
    };
    const read = videoFromRow(old)!;
    expect(read.camera.map((s) => s.length)).toEqual([3, 3]);
    expect(read.layouts.map((l) => l.poses.a.x)).toEqual([0, 50]);
    expect(ease('linear', 0.5)).toBe(0.5);
  });
});

describe('lock shot to layer', () => {
  it('predicts the topmost layer covering the majority of a nested shot', () => {
    const backdrop = { ...image('big', 0), x: 0, y: 0, width: 10000, height: 15000, z: 1 };
    const parent = { ...image('mid', 0), x: 2000, y: 2000, width: 1000, height: 1500, z: 2 };
    const tiny = { ...image('tiny', 0), x: 2400, y: 2400, width: 100, height: 150, z: 3 };
    const items = [backdrop, parent, tiny];
    // Shot framing the tiny top photo predicts `tiny` even though `parent` and `backdrop` also cover it
    expect(predictedLayerForShot({ x: 2400, y: 2400, width: 100, height: 150 }, items)?.id).toBe(
      'tiny',
    );
    // Shot framing `parent` (with `tiny` covering < 2% of it) predicts `parent`
    expect(predictedLayerForShot({ x: 2000, y: 2000, width: 1000, height: 1500 }, items)?.id).toBe(
      'mid',
    );
    // Shot framing `backdrop` predicts `big`
    expect(predictedLayerForShot({ x: 0, y: 0, width: 10000, height: 15000 }, items)?.id).toBe(
      'big',
    );
  });

  it('moves, scales, and cleans up locked shots when their layer changes or is removed', () => {
    const prev = [
      { ...image('a', 0), x: 100, y: 200, width: 400, height: 600, z: 1 },
      { ...image('b', 0), x: 1000, y: 0, width: 400, height: 600, z: 2 },
    ];
    const base = newVideo(view);
    const lockedStop: CameraStop = {
      id: 's1',
      frame: { x: 150, y: 250, width: 180, height: 320 },
      length: 3,
      arrival: 'cut',
      arrivalTime: 1,
      stay: 'still',
      easing: 'smooth',
      lockToLayer: 'a',
    };
    const unlockedStop: CameraStop = {
      id: 's2',
      frame: { x: 1000, y: 0, width: 180, height: 320 },
      length: 3,
      arrival: 'glide',
      arrivalTime: 1,
      stay: 'still',
      easing: 'smooth',
    };
    const video = { ...base, camera: [lockedStop, unlockedStop] };

    // Moving + doubling size of layer `a` moves and doubles shot `s1`, leaving `s2` untouched
    const scaled = [{ ...prev[0], x: 500, y: 600, width: 800, height: 1200 }, prev[1]];
    const afterScale = followLockedLayers(video, prev, scaled);
    expect(afterScale.camera[0].frame).toEqual({ x: 600, y: 700, width: 360, height: 640 });
    expect(afterScale.camera[1]).toBe(unlockedStop);

    // Round-trips `lockToLayer` through storage
    expect(videoFromRow(JSON.parse(JSON.stringify(afterScale)))!.camera[0].lockToLayer).toBe('a');

    // Deleting layer `a` clears `lockToLayer` cleanly
    const afterRemove = followLockedLayers(afterScale, scaled, [prev[1]]);
    expect(afterRemove.camera[0].lockToLayer).toBeUndefined();
  });
});

import { autoEdit, EditInput, EditStyle } from '../common/auto-edit';
import { Rect } from '../common/workspace';

// 45 photos in five columns, and again in a grid of 5 × 9; a title over them
const columns = new Map<string, Rect>(
  Array.from({ length: 45 }, (_, i) => [
    `p${i}`,
    {
      x: (i % 5) * 220,
      y: Math.floor(i / 5) * 160 + (i % 3) * 20,
      width: 200,
      height: 140 + (i % 3) * 40,
    },
  ]),
);
const grid = new Map<string, Rect>(
  Array.from({ length: 45 }, (_, i) => [
    `p${i}`,
    { x: (i % 5) * 210, y: Math.floor(i / 5) * 210, width: 200, height: 200 },
  ]),
);
const title = { x: 0, y: -260, width: 1080, height: 220 };
// 141 beats a minute, the song beginning on a beat
const beats = Array.from({ length: 80 }, (_, i) => i * (60 / 141));

let ids = 0;
const input = (more: Partial<EditInput> = {}): EditInput => ({
  beats,
  length: 30,
  aspect: 1080 / 1920,
  layouts: [columns, grid],
  title,
  style: 'cuts',
  seed: 1,
  newId: () => `id${ids++}`,
  ...more,
});
const withoutIds = (edit: ReturnType<typeof autoEdit>) =>
  JSON.stringify({
    ...edit,
    camera: edit.camera.map((stop) => ({ ...stop, id: '' })),
    motions: edit.motions.map((motion) => ({ ...motion, id: '' })),
  });

describe('autoEdit', () => {
  for (const style of ['cuts', 'flow', 'mixed'] as EditStyle[]) {
    it(`makes a ${style} edit as long as the video, every cut on a beat, every shot in its shape`, () => {
      const edit = autoEdit(input({ style }));
      const total = edit.camera.reduce((sum, stop) => sum + stop.length, 0);
      expect(total).toBeCloseTo(30, 5);
      let time = 0;
      for (const stop of edit.camera) {
        // Every shot begins on a beat
        expect(beats.some((beat) => Math.abs(beat - time) < 1e-6)).toBe(true);
        expect(stop.frame.width / stop.frame.height).toBeCloseTo(1080 / 1920, 5);
        expect(stop.length).toBeGreaterThan(0);
        time += stop.length;
      }
      expect(edit.layoutLengths.reduce((sum, l) => sum + l, 0)).toBeCloseTo(30, 5);
      expect(edit.layoutLengths).toHaveLength(2);
      // Its motions within the video, on photos that are there
      for (const motion of edit.motions) {
        expect(motion.start).toBeGreaterThanOrEqual(0);
        expect(motion.start + motion.length).toBeLessThanOrEqual(30 + 1e-6);
        motion.targets.forEach((id) => expect(columns.has(id)).toBe(true));
      }
    });
  }

  it('opens on a photo filling the screen, then the title, and ends on everything as it fades', () => {
    const edit = autoEdit(input());
    const [first, second] = edit.camera.map((stop) => stop.frame);
    const photo = columns.get('p0')!;
    const shown =
      Math.max(
        0,
        Math.min(first.x + first.width, photo.x + photo.width) - Math.max(first.x, photo.x),
      ) *
      Math.max(
        0,
        Math.min(first.y + first.height, photo.y + photo.height) - Math.max(first.y, photo.y),
      );
    expect(shown / (first.width * first.height)).toBeGreaterThan(0.5);
    expect(second.x).toBeLessThanOrEqual(title.x);
    expect(second.x + second.width).toBeGreaterThanOrEqual(title.x + title.width);
    // The opening photo is there from the first frame, the others come in as the camera leaves it
    const dropIn = edit.motions.find((m) => m.kind === 'drop-in')!;
    expect(dropIn.targets).not.toContain('p0');
    expect(dropIn.start).toBeGreaterThan(edit.camera[0].length - 0.01);
    expect(edit.motions.some((m) => m.kind === 'fade-out')).toBe(true);
    // The layouts switch with a shake
    expect(edit.motions.some((m) => m.kind === 'shake')).toBe(true);
  });

  it('gives the same edit for the same seed, another for another', () => {
    const a = withoutIds(autoEdit(input({ seed: 3 })));
    expect(withoutIds(autoEdit(input({ seed: 3 })))).toBe(a);
    expect(withoutIds(autoEdit(input({ seed: 4 })))).not.toBe(a);
  });

  it('never shows a photo twice in a row', () => {
    const edit = autoEdit(input({ seed: 9 }));
    const frames = edit.camera.map((stop) => JSON.stringify(stop.frame));
    frames.slice(1).forEach((frame, i) => expect(frame).not.toBe(frames[i]));
  });

  it('gives every layout it shows a section of its own, and the rest a place after the end', () => {
    // 80 beats at 141 a minute is 34 s, but the video lasts 12: room for a few sections only
    const edit = autoEdit(
      input({ layouts: [columns, grid, columns, grid, columns, grid], length: 12 }),
    );
    const inVideo = edit.layoutLengths.filter((_, i) => {
      const start = edit.layoutLengths.slice(0, i).reduce((sum, l) => sum + l, 0);
      return start < 12;
    });
    expect(inVideo.length).toBeLessThan(6);
    inVideo.forEach((length) => expect(length).toBeGreaterThan(1));
    expect(inVideo.reduce((sum, l) => sum + l, 0)).toBeCloseTo(12, 5);
  });

  it('films only the photos of the layout on screen', () => {
    const firstHalf = new Map([...columns].slice(0, 20));
    const secondHalf = new Map([...grid].slice(20));
    for (const style of ['cuts', 'flow', 'mixed'] as EditStyle[]) {
      expect(() => autoEdit(input({ layouts: [firstHalf, secondHalf], style }))).not.toThrow();
    }
  });

  it('works without a song, a title or a second layout', () => {
    const edit = autoEdit(input({ beats: [], title: undefined, layouts: [columns], length: 12 }));
    expect(edit.camera.reduce((sum, stop) => sum + stop.length, 0)).toBeCloseTo(12, 5);
    expect(edit.layoutLengths).toEqual([12]);
  });
});

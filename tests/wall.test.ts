import {
  columnShapeOf,
  originalsOf,
  wallItems,
  wallOfCopies,
  WallCopy,
  WallObstacle,
  WallPhoto,
} from '../common/wall';
import { overlaps, WorkspaceItem } from '../common/workspace';

const COLUMN = 100;
const GAP = 8;
const STEP = COLUMN + GAP;

/** A photo on the block: its file, and where it is */
const photo = (fileId: string, x: number, y: number, height: number): WallObstacle => ({
  fileId,
  x,
  y,
  width: COLUMN,
  height,
});

/** A block of two columns, a title over the first two, and the photos of a wall */
const block: WallObstacle[] = [
  { x: 0, y: -60, width: 2 * COLUMN + GAP, height: 40 },
  photo('a', 0, 0, 100),
  photo('b', 0, 108, 100),
  photo('c', STEP, 0, 200),
];
const photos: WallPhoto[] = [
  { fileId: 'a', imageAspect: 1 },
  { fileId: 'b', imageAspect: 1.5 },
  { fileId: 'c', imageAspect: 0.75 },
];
const options = { columns: 2, above: 300, below: 300, seed: 7 };

const wall = (obstacles = block, list = photos, seed = options.seed) =>
  wallOfCopies(obstacles, list, COLUMN, GAP, { ...options, seed });

/** The column of a rect on the wall, the block's first column at 0 */
const columnOf = (rect: { x: number }) => Math.round(rect.x / STEP);

/**
 * The rule of a wall, checked over everything on it: in each column, the photo directly above and below any
 * photo is of another file; and in the next column, no photo of the same file comes within a gap of it
 */
function expectNoSameFileNeighbours(
  photosOnWall: { fileId: string; x: number; y: number; height: number }[],
) {
  const columns = new Map<number, typeof photosOnWall>();
  for (const p of photosOnWall) {
    columns.set(columnOf(p), [...(columns.get(columnOf(p)) ?? []), p]);
  }
  for (const inColumn of columns.values()) {
    const sorted = [...inColumn].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].fileId).not.toBe(sorted[i - 1].fileId);
    }
  }
  for (const a of photosOnWall) {
    for (const b of photosOnWall) {
      if (a !== b && a.fileId === b.fileId && Math.abs(columnOf(a) - columnOf(b)) === 1) {
        const apart = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
        expect(apart).toBeGreaterThanOrEqual(GAP);
      }
    }
  }
}

describe('a wall of copies', () => {
  it('extends the block to the left and right, and above and below it', () => {
    const copies = wall();
    expect(copies.length).toBeGreaterThan(20);
    expect(copies.some((copy) => copy.x < 0)).toBe(true);
    expect(copies.some((copy) => copy.x > 2 * COLUMN)).toBe(true);
    expect(copies.some((copy) => copy.y < -60)).toBe(true);
    expect(copies.some((copy) => copy.y + copy.height > 208)).toBe(true);
    // Within the reach asked for: above and below the block, and the width of the columns
    for (const copy of copies) {
      expect(copy.y).toBeGreaterThanOrEqual(-60 - 300);
      expect(copy.y + copy.height).toBeLessThanOrEqual(208 + 300);
      expect(copy.width).toBe(COLUMN);
      expect(copy.height).toBe(Math.floor(COLUMN / copy.imageAspect));
    }
  });

  it('puts every photo of the workspace on the wall, in the order of the seed', () => {
    const copies = wall();
    expect(new Set(copies.map((copy) => copy.fileId))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('overlaps nothing that is there, nor another copy', () => {
    const copies = wall();
    for (const copy of copies) {
      for (const other of block) {
        expect(overlaps(copy, other)).toBe(false);
      }
    }
    copies.forEach((copy, i) =>
      copies.slice(i + 1).forEach((other) => expect(overlaps(copy, other)).toBe(false)),
    );
  });

  it('never puts a photo next to a copy of its own', () => {
    const copies = wall();
    expectNoSameFileNeighbours([...block.filter((o) => o.fileId !== undefined), ...copies] as {
      fileId: string;
      x: number;
      y: number;
      height: number;
    }[]);
  });

  it('keeps the same rule with a single photo', () => {
    const copies = wall(block, [{ fileId: 'a', imageAspect: 1 }]);
    expectNoSameFileNeighbours([...block.filter((o) => o.fileId !== undefined), ...copies] as {
      fileId: string;
      x: number;
      y: number;
      height: number;
    }[]);
  });

  it('is the same wall for the same seed, and another for another seed', () => {
    const copies: WallCopy[] = wall();
    expect(wall()).toEqual(copies);
    expect(wall(block, photos, 8)).not.toEqual(copies);
  });

  it('makes nothing without photos or without room', () => {
    expect(wall(block, [])).toEqual([]);
    expect(wall([{ x: 0, y: 0, width: 10, height: 10 }])).toEqual([]);
  });
});

describe('the columns of photos', () => {
  it('are as wide as the photos, and as far apart as the gap between them', () => {
    expect(
      columnShapeOf([photo('a', 0, 0, 50), photo('b', STEP, 0, 50), photo('c', STEP, 200, 30)]),
    ).toEqual({
      columnWidth: COLUMN,
      gap: GAP,
    });
  });

  it('takes the layout gap for a single column', () => {
    expect(columnShapeOf([photo('a', 0, 0, 50), photo('b', 0, 60, 50)])).toEqual({
      columnWidth: COLUMN,
      gap: GAP,
    });
  });

  it('refuses photos that are not in columns', () => {
    expect(() =>
      columnShapeOf([photo('a', 0, 0, 50), { ...photo('b', STEP, 0, 50), width: 40 }]),
    ).toThrow('not in columns');
  });
});

describe('the wall as items', () => {
  const item = (fileId: string, x: number, y: number, height: number, z: number) => ({
    kind: 'image' as const,
    id: fileId,
    fileId,
    imageAspect: COLUMN / height,
    x,
    y,
    z,
    width: COLUMN,
    height,
  });
  const workspace: WorkspaceItem[] = [
    {
      kind: 'text',
      id: 't',
      text: 'Title',
      color: '',
      fontSize: 20,
      x: 0,
      y: -60,
      z: 0,
      width: 208,
      height: 40,
    },
    item('a', 0, 0, 100, 1),
    item('b', 0, 108, 100, 2),
    item('c', STEP, 0, 200, 3),
    {
      kind: 'background',
      id: 'sheet',
      color: '#fff',
      format: 'A4',
      x: -2000,
      y: -2000,
      z: 0,
      width: 6000,
      height: 6000,
    },
  ];

  it('appends copies with new ids and z in front, the sheet behind is no obstacle', () => {
    let ids = 0;
    const copies = wallItems(workspace, options, () => `copy-${ids++}`, 10);
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.map((copy) => copy.id)).toEqual(copies.map((_, i) => `copy-${i}`));
    expect(copies.map((copy) => copy.z)).toEqual(copies.map((_, i) => 10 + i));
    expect(copies.every((copy) => copy.kind === 'image')).toBe(true);
    expect(copies.every((copy) => copy.imageAspect > 0)).toBe(true);
  });

  it('refuses a workspace without photos', () => {
    expect(() => wallItems([], options, () => 'x', 0)).toThrow('A wall takes photos');
  });
});

describe('originals', () => {
  it('are the first photo of each file', () => {
    const copies = [{ fileId: 'a' }, { fileId: 'b' }, { fileId: 'a' }];
    expect(originalsOf(copies)).toEqual([{ fileId: 'a' }, { fileId: 'b' }]);
  });
});

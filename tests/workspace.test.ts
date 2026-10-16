import {
  addGroup,
  bringToFront,
  boundsOf,
  Camera,
  cameraBetween,
  fitCamera,
  changeText,
  createText,
  GROUP_LABEL_SPACE,
  LABEL_FONT_SIZE,
  layersFromTop,
  MIN_FONT_SIZE,
  moveLayers,
  TEXT_LINE_HEIGHT,
  GROUP_ROW_HEIGHT,
  GROUP_SPACING,
  gridLevels,
  MAX_ZOOM,
  MIN_ITEM_WIDTH,
  MIN_ZOOM,
  moveItems,
  nextGroupOrigin,
  overlaps,
  panBy,
  placeGroup,
  resizeItem,
  SpatialIndex,
  toScreen,
  toWorld,
  visibleRect,
  wheelZoomFactor,
  WorkspaceImageItem,
  workspaceFromRow,
  zoomAt,
  arrangeItems,
  layOut,
  LAYOUT_GAP,
  readingOrder,
  changeBackground,
  contains,
  createBackground,
  groupUnder,
  PAPER_FORMATS,
  Rect,
  snapMove,
  suggestedCount,
  swapItems,
} from '../common/workspace';

const item = (fileId: string, x: number, y: number, z: number, size = 100): WorkspaceImageItem => ({
  kind: 'image',
  id: fileId,
  fileId,
  imageAspect: 1,
  x,
  y,
  width: size,
  height: size,
  z,
});

/** Letters half as wide as they are high */
const measure = (line: string, fontSize: number) => line.length * fontSize * 0.5;

describe('the camera', () => {
  const camera: Camera = { x: 100, y: -50, zoom: 2 };

  it('turns world points into screen points and back', () => {
    expect(toScreen(camera, { x: 110, y: -40 })).toEqual({ x: 20, y: 20 });
    expect(toWorld(camera, { x: 20, y: 20 })).toEqual({ x: 110, y: -40 });
  });

  it('pans with the drag: the surface follows the pointer', () => {
    const moved = panBy(camera, 40, -20);
    expect(toScreen(moved, { x: 110, y: -40 })).toEqual({ x: 60, y: 0 });
  });

  it('keeps the point under the pointer in place while zooming', () => {
    const pointer = { x: 300, y: 200 };
    const before = toWorld(camera, pointer);
    const zoomed = zoomAt(camera, pointer, 3.7);
    expect(zoomed.zoom).toBeCloseTo(7.4);
    const after = toWorld(zoomed, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zooms out and in without end in practice, but within limits', () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 1e-9).zoom).toBe(MIN_ZOOM);
    expect(zoomAt(camera, { x: 0, y: 0 }, 1e9).zoom).toBe(MAX_ZOOM);
    expect(MIN_ZOOM).toBeLessThanOrEqual(1 / 1000);
  });

  it('zooms back to where it began after the same turn of the wheel either way', () => {
    expect(wheelZoomFactor(100) * wheelZoomFactor(-100)).toBeCloseTo(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1); // wheel up: in
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    // Many small touchpad amounts make the same zoom as one large one
    expect(Math.pow(wheelZoomFactor(10), 10)).toBeCloseTo(wheelZoomFactor(100));
  });

  it('knows what part of the world is in view', () => {
    expect(visibleRect(camera, { width: 800, height: 600 })).toEqual({
      x: 100,
      y: -50,
      width: 400,
      height: 300,
    });
  });

  it('fits everything in the middle of the view, never larger than 100%', () => {
    const view = { width: 1000, height: 500 };
    const bounds = { x: 0, y: 0, width: 4000, height: 1000 };
    const fitted = fitCamera(bounds, view, 0);
    expect(fitted.zoom).toBeCloseTo(0.25);
    const middle = toScreen(fitted, { x: 2000, y: 500 });
    expect(middle.x).toBeCloseTo(500);
    expect(middle.y).toBeCloseTo(250);
    expect(fitCamera({ x: 0, y: 0, width: 10, height: 10 }, view).zoom).toBe(1);
    // One image looked at closely may be enlarged
    expect(fitCamera({ x: 0, y: 0, width: 10, height: 10 }, view, 0, MAX_ZOOM).zoom).toBe(MAX_ZOOM);
  });

  it('travels from one camera to another, ending exactly there', () => {
    const view = { width: 800, height: 600 };
    const from: Camera = { x: 0, y: 0, zoom: 1 };
    const to: Camera = { x: 1000, y: 500, zoom: 4 };
    expect(cameraBetween(from, to, 0, view)).toEqual(from);
    const end = cameraBetween(from, to, 1, view);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.y).toBeCloseTo(to.y);
    expect(end.zoom).toBeCloseTo(to.zoom);
    // Halfway, the zoom is halfway to the eye: 2, not 2.5
    expect(cameraBetween(from, to, 0.5, view).zoom).toBeCloseTo(2);
  });
});

describe('placing images', () => {
  it('starts at the origin of an empty workspace and goes right of what is there', () => {
    expect(nextGroupOrigin([])).toEqual({ x: 0, y: 0 });
    expect(nextGroupOrigin([item('a', -50, 20, 0), item('b', 300, 400, 1)])).toEqual({
      x: 400 + GROUP_SPACING,
      y: 20,
    });
  });

  it('lays a batch out under room for its name, in their shape, in the order given', () => {
    const images = [
      { fileId: 'wide', width: 3000, height: 1500 },
      { fileId: 'tall', width: 1000, height: 2000 },
      { fileId: 'unknown', width: 0, height: 0 },
    ];
    const placed = placeGroup(images, { x: 10, y: 20 }, 5, {
      kind: 'rows',
      width: 10000,
      rowHeight: GROUP_ROW_HEIGHT,
    });
    expect(placed.map((p) => p.fileId)).toEqual(['wide', 'tall', 'unknown']);
    expect(placed.map((p) => p.z)).toEqual([5, 6, 7]);
    expect(placed.every((p) => p.height === GROUP_ROW_HEIGHT)).toBe(true);
    expect(placed[0]).toMatchObject({
      x: 10,
      y: 20 + GROUP_LABEL_SPACE,
      width: 2 * GROUP_ROW_HEIGHT,
    });
    expect(placed[1].width).toBe(GROUP_ROW_HEIGHT / 2);
    expect(placed[2].width).toBe(GROUP_ROW_HEIGHT); // a square when the shape is not known
    // Nothing overlaps
    for (const a of placed) {
      for (const b of placed) {
        expect(a === b || !overlaps(a, b)).toBe(true);
      }
    }
  });

  it('makes a block about as wide as a monitor for many images', () => {
    const images = Array.from({ length: 200 }, (_, i) => ({ fileId: `${i}`, width: 3, height: 2 }));
    const bounds = boundsOf(placeGroup(images, { x: 0, y: 0 }, 0))!;
    expect(bounds.width / bounds.height).toBeGreaterThan(1.2);
    expect(bounds.width / bounds.height).toBeLessThan(2.4);
  });

  it('adds a batch next to the others, in front of everything, with its name as a text above it', () => {
    const items = addGroup(
      [item('a', 0, 0, 7)],
      'Second',
      [{ fileId: 'b', width: 1, height: 1 }],
      'name',
      measure,
    );
    expect(items[1]).toMatchObject({ kind: 'image', id: 'b', z: 8, x: 100 + GROUP_SPACING });
    expect(items[2]).toMatchObject({ kind: 'text', id: 'name', text: 'Second', z: 9 });
    expect(items[2].x).toBe(100 + GROUP_SPACING);
    // Above the images, in the room left for it
    expect(items[2].y + items[2].height).toBeLessThanOrEqual(items[1].y);
  });
});

describe('layouts, like the views of the Library', () => {
  const shapes = [
    { width: 300, height: 200 },
    { width: 200, height: 300 },
    { width: 100, height: 100 },
    { width: 400, height: 200 },
    { width: 300, height: 300 },
  ];
  const noOverlaps = (rects: Rect[]) =>
    rects.every((a, i) => rects.every((b, j) => i === j || !overlaps(a, b)));

  it('fills rows to their width as the gallery does, each row of one height, the last as it is', () => {
    const rects = layOut(shapes, { x: 0, y: 0 }, { kind: 'rows', width: 500, rowHeight: 100 });
    expect(noOverlaps(rects)).toBe(true);
    const rows = new Map<number, Rect[]>();
    rects.forEach((r) => rows.set(r.y, [...(rows.get(r.y) ?? []), r]));
    const lines = [...rows.values()];
    for (const row of lines.slice(0, -1)) {
      expect(new Set(row.map((r) => r.height)).size).toBe(1);
      const last = row[row.length - 1];
      // The gallery scales a row with the space after its last image: that space stays free
      expect(last.x + last.width).toBeGreaterThan(500 - 2 * LAYOUT_GAP);
      expect(last.x + last.width).toBeLessThanOrEqual(500);
    }
    // Each keeps its shape
    rects.forEach((r, i) =>
      expect(Math.abs(r.width - (r.height * shapes[i].width) / shapes[i].height)).toBeLessThan(2),
    );
  });

  it('puts each image in the shortest column', () => {
    const rects = layOut(
      shapes,
      { x: 10, y: 0 },
      { kind: 'columns', columns: 2, columnWidth: 100 },
    );
    expect(noOverlaps(rects)).toBe(true);
    // The fourth goes to the second column: the lower of the two when its turn comes
    const right = 10 + 100 + LAYOUT_GAP;
    expect(rects.map((r) => r.x)).toEqual([10, right, 10, right, 10]);
    expect(rects.every((r) => r.width === 100)).toBe(true);
  });

  it('puts each image whole in the middle of a square cell of a grid', () => {
    const rects = layOut(shapes, { x: 0, y: 0 }, { kind: 'grid', columns: 2, cell: 100 });
    expect(rects[0]).toMatchObject({ x: 0, width: 100 });
    expect(rects[0].y).toBeCloseTo((100 - 100 / 1.5) / 2);
    expect(rects[1]).toMatchObject({ y: 0, height: 100 });
    expect(rects[1].x).toBeCloseTo(100 + LAYOUT_GAP + (100 - 100 / 1.5) / 2);
    expect(rects[2]).toMatchObject({ x: 0, y: 100 + LAYOUT_GAP, width: 100, height: 100 });
  });

  it('reads row by row, each row from left to right', () => {
    const rects = [
      { id: 'c', x: 0, y: 110, width: 100, height: 100 },
      { id: 'b', x: 200, y: 5, width: 100, height: 100 },
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'd', x: 150, y: 120, width: 100, height: 100 },
    ];
    expect(readingOrder(rects).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('arranges what is chosen in a grid where the first of it was, in front of the rest', () => {
    const items = [
      item('a', 500, 500, 0, 100),
      item('b', 900, 100, 1, 100),
      item('c', 40, 40, 2, 100),
      item('other', 0, 0, 9, 100),
    ];
    const arranged = arrangeItems(items, new Set(['a', 'b', 'c']), 'grid', 2);
    const at = (id: string) => arranged.find((i) => i.id === id)!;
    // Reading order: c (top left), b (top right), a
    expect(at('c')).toMatchObject({ x: 40, y: 40 });
    expect(at('b')).toMatchObject({ x: 40 + 100 + LAYOUT_GAP, y: 40 });
    expect(at('a')).toMatchObject({ x: 40, y: 40 + 100 + LAYOUT_GAP });
    expect(at('other')).toBe(items[3]);
    expect([at('c').z, at('b').z, at('a').z]).toEqual([10, 11, 12]);
  });

  it('makes about as many rows as asked for', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`${i}`, i * 300, 0, i, 100));
    const arranged = arrangeItems(items, new Set(items.map((i) => i.id)), 'rows', 3);
    expect(new Set(arranged.map((i) => Math.round(i.y))).size).toBe(3);
  });

  it('suggests a block about as wide as a monitor', () => {
    expect(suggestedCount('grid', 16)).toBe(5);
    expect(suggestedCount('rows', 16)).toBe(4);
    expect(suggestedCount('columns', 2)).toBe(2);
  });
});

describe('snapping', () => {
  const others = [{ x: 0, y: 0, width: 100, height: 100 }];
  const moving = { x: 300, y: 300, width: 50, height: 50 };

  it('lines an edge up with an edge it comes near, and shows where', () => {
    // Left edge to 103 would be 3 off the right edge of the other (100)
    const snapped = snapMove(moving, others, -197, -150, 5);
    expect(snapped.dx).toBe(-200);
    expect(snapped.dy).toBe(-150);
    // From the top of the other to the foot of what is dragged
    expect(snapped.guides).toEqual([{ kind: 'line', axis: 'x', at: 100, from: 0, to: 200 }]);
  });

  it('lines middles up, in both directions at once', () => {
    // Middle 325 + dx near the middle of the other (50); same for y
    const snapped = snapMove(moving, others, -273, -277, 5);
    expect(snapped.dx).toBe(-275);
    expect(snapped.dy).toBe(-275);
    expect(snapped.guides.map((g) => [g.axis, g.at])).toEqual([
      ['x', 50],
      ['y', 50],
    ]);
  });

  it('does not snap from further away', () => {
    const snapped = snapMove(moving, others, -190, -150, 5);
    expect(snapped).toEqual({ dx: -190, dy: -150, guides: [] });
  });
});

describe('texts', () => {
  it('are as large as their letters, line by line', () => {
    const text = createText('t', 'Film\nPortra 400', { x: 5, y: 6 }, 3, measure, 20);
    expect(text).toMatchObject({
      kind: 'text',
      id: 't',
      x: 5,
      y: 6,
      z: 3,
      color: '',
      fontSize: 20,
    });
    expect(text.width).toBe(measure('Portra 400', 20));
    expect(text.height).toBe(2 * 20 * TEXT_LINE_HEIGHT);
  });

  it('take the size of other words or letters, and never letters too small', () => {
    const text = createText('t', 'A', { x: 0, y: 0 }, 0, measure);
    const longer = changeText(text, { text: 'A longer one' }, measure);
    expect(longer.width).toBe(measure('A longer one', LABEL_FONT_SIZE));
    const coloured = changeText(longer, { color: 'var(--accent-color)' }, measure);
    expect(coloured).toMatchObject({ color: 'var(--accent-color)', width: longer.width });
    expect(changeText(text, { fontSize: 0 }, measure).fontSize).toBe(MIN_FONT_SIZE);
  });

  it('grow their letters when they are made larger', () => {
    const text = createText('t', 'Hello', { x: 0, y: 0 }, 0, measure, 10);
    const larger = resizeItem(text, text.width * 3);
    expect(larger.fontSize).toBeCloseTo(30);
    expect(larger.height).toBeCloseTo(text.height * 3);
  });
});

describe('back to front', () => {
  it('brings a covered image to the front', () => {
    const items = [item('back', 0, 0, 0), item('front', 50, 50, 1)];
    const result = bringToFront(items, 'back');
    expect(result.find((i) => i.id === 'back')!.z).toBe(2);
    expect(result.find((i) => i.id === 'front')!.z).toBe(1);
  });

  it('changes nothing when the image is already on top of what it overlaps', () => {
    const items = [item('top', 0, 0, 5), item('under', 50, 50, 1), item('apart', 500, 500, 9)];
    expect(bringToFront(items, 'top')).toBe(items);
    expect(bringToFront(items, 'missing')).toBe(items);
  });

  it('puts moved images down on top of the others, in their own order', () => {
    const items = [item('a', 0, 0, 5), item('b', 500, 0, 1), item('c', 900, 0, 3)];
    const moved = moveItems(items, new Set(['b', 'c']), 10, -20);
    expect(moved.map((i) => [i.id, i.x, i.y, i.z])).toEqual([
      ['a', 0, 0, 5],
      ['b', 510, -20, 6],
      ['c', 910, -20, 7],
    ]);
  });

  it('lists the layers from the top down, and moves some of them to another place', () => {
    const items = [item('a', 0, 0, 0), item('b', 0, 0, 1), item('c', 0, 0, 2), item('d', 0, 0, 3)];
    expect(layersFromTop(items).map((i) => i.id)).toEqual(['d', 'c', 'b', 'a']);
    // a and d to the second place from the top (counted without them): c, a, d, b
    const moved = moveLayers(items, new Set(['a', 'd']), 1);
    expect(layersFromTop(moved).map((i) => i.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(moved.map((i) => i.z).sort()).toEqual([0, 1, 2, 3]);
    // To the top and the bottom
    expect(layersFromTop(moveLayers(items, new Set(['a']), 0))[0].id).toBe('a');
    expect(layersFromTop(moveLayers(items, new Set(['d']), 99))[3].id).toBe('d');
  });

  it('sizes an image in its shape, not smaller than the minimum', () => {
    const wide = { ...item('a', 0, 0, 0), width: 200, height: 100 };
    expect(resizeItem(wide, 400)).toMatchObject({ width: 400, height: 200 });
    expect(resizeItem(wide, 1).width).toBe(MIN_ITEM_WIDTH);
  });
});

describe('SpatialIndex', () => {
  it('finds the images in an area, also after they moved or left', () => {
    const index = new SpatialIndex(100);
    index.set('a', { x: 0, y: 0, width: 50, height: 50 });
    index.set('b', { x: 1000, y: 1000, width: 50, height: 50 });
    index.set('big', { x: -500, y: -500, width: 2000, height: 2000 });
    expect(index.query({ x: 10, y: 10, width: 10, height: 10 })).toEqual(new Set(['a', 'big']));

    index.set('a', { x: 990, y: 990, width: 50, height: 50 });
    expect(index.query({ x: 10, y: 10, width: 10, height: 10 })).toEqual(new Set(['big']));
    expect(index.query({ x: 1010, y: 1010, width: 5, height: 5 })).toEqual(
      new Set(['a', 'b', 'big']),
    );

    index.delete('big');
    expect(index.size).toBe(2);
    expect(index.query({ x: 10, y: 10, width: 10, height: 10 })).toEqual(new Set());
  });

  it('answers just the same when zoomed far out', () => {
    const index = new SpatialIndex(10);
    index.set('a', { x: 0, y: 0, width: 5, height: 5 });
    index.set('b', { x: 5000, y: 5000, width: 5, height: 5 });
    expect(index.query({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 })).toEqual(new Set(['a', 'b']));
    expect(index.query({ x: -1e6, y: -1e6, width: 1e6 + 100, height: 1e6 + 100 })).toEqual(
      new Set(['a']),
    );
  });
});

describe('gridLevels', () => {
  it('keeps the fine lines between 12 and 48 pixels apart on the screen at every zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.01, 0.3, 1, 1.7, 5, MAX_ZOOM]) {
      const { fine, major } = gridLevels(zoom);
      expect(fine * zoom).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(fine * zoom).toBeLessThan(48 + 1e-6);
      expect(major).toBe(fine * 4);
    }
  });

  it('fades the fine lines in as they spread apart, without a jump between levels', () => {
    expect(gridLevels(12 / 16).fineOpacity).toBeCloseTo(0); // 16 units, 12 px apart: just appearing
    expect(gridLevels(24 / 16).fineOpacity).toBeCloseTo(0.5);
    // Just before a level change the fine lines are fully there and become the next major lines
    const before = gridLevels(47.99 / 16);
    const after = gridLevels(48.01 / 16);
    expect(before.fineOpacity).toBeCloseTo(1, 2);
    expect(after.major).toBe(before.fine);
  });
});

describe('workspaceFromRow', () => {
  it('reads a stored workspace back', () => {
    const row = {
      id: 'w1',
      name: 'Moodboard',
      index: 2,
      items: [item('a', 1, 2, 3), createText('t', 'Film', { x: 0, y: 0 }, 4, measure)],
      camera: { x: 5, y: 6, zoom: 0.5 },
      isLocked: true,
    };
    expect(workspaceFromRow(row, measure)).toEqual(row);
  });

  it('turns the names of batches of earlier versions into texts above their images', () => {
    const read = workspaceFromRow(
      {
        id: 'w0',
        name: 'Old',
        items: [{ fileId: 'a', x: 0, y: 40, width: 100, height: 100, z: 0 }],
        groups: [{ label: 'Film', x: 0, y: 0 }],
      },
      measure,
    )!;
    expect(read.items[0]).toMatchObject({ kind: 'image', id: 'a', fileId: 'a' });
    expect(read.items[1]).toMatchObject({ kind: 'text', text: 'Film', x: 0, z: 1 });
    expect(read.items[1].y + read.items[1].height).toBeLessThanOrEqual(40);
    expect('groups' in read).toBe(false);
  });

  it('leaves out what is damaged instead of failing', () => {
    expect(workspaceFromRow(null, measure)).toBeUndefined();
    expect(workspaceFromRow({ name: 'no id' }, measure)).toBeUndefined();
    const read = workspaceFromRow(
      {
        id: 'w2',
        name: '  ',
        items: [
          item('ok', 0, 0, 0),
          { fileId: 'bad', x: NaN },
          { ...item('flat', 0, 0, 1), height: 0 },
          { kind: 'text', id: 'no words', x: 0, y: 0, z: 2, width: 1, height: 1 },
        ],
        camera: { x: 0, y: 0, zoom: 1e9 },
      },
      measure,
    )!;
    expect(read.name).toBe('Workspace');
    expect(read.items.map((i) => i.id)).toEqual(['ok']);
    expect(read.camera.zoom).toBe(MAX_ZOOM);
    expect(read.isLocked).toBe(false);
  });
});

describe('even spacing', () => {
  // Two images 20 apart in a row; a third dragged along the same row
  const left = { x: 0, y: 0, width: 100, height: 100 };
  const middle = { x: 120, y: 0, width: 100, height: 100 };
  const moving = { x: 400, y: 10, width: 100, height: 80 };

  it('leaves the same gap after the last one as there is between the others, and shows both', () => {
    // 400 - 157 = 243: 3 from 240, where the gap to the middle one is 20 too
    const snapped = snapMove(moving, [left, middle], -157, 0, 5);
    expect(snapped.dx).toBe(-160);
    const gaps = snapped.guides.filter((g) => g.kind === 'gap');
    expect(gaps.map((g) => [g.from, g.to])).toEqual([
      [220, 240],
      [100, 120],
    ]);
  });

  it('puts it in the middle between two', () => {
    const right = { x: 400, y: 0, width: 100, height: 100 };
    const between = { x: 900, y: 0, width: 60, height: 100 };
    // The room between 220 and 400 is 180: 60 wide, it is in the middle at 280
    const snapped = snapMove(between, [middle, right], -618, 0, 5);
    expect(snapped.dx).toBe(-620);
    expect(snapped.guides.filter((g) => g.kind === 'gap').length).toBe(2);
  });

  it('only looks at what is in the same row', () => {
    const below = { x: 0, y: 500, width: 100, height: 100 };
    const belowToo = { x: 120, y: 500, width: 100, height: 100 };
    const snapped = snapMove(moving, [below, belowToo], -157, 0, 5);
    expect(snapped.dx).toBe(-157);
  });
});

describe('crops and spacing', () => {
  const shapes = [
    { width: 300, height: 200 },
    { width: 200, height: 300 },
  ];

  it('cuts to portraits of 4 by 5, in cells as tall as that', () => {
    const rects = layOut(
      shapes,
      { x: 0, y: 0 },
      { kind: 'grid', columns: 1, cell: 100, crop: '4:5' },
    );
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 100, height: 125 });
    expect(rects[1]).toEqual({ x: 0, y: 125 + LAYOUT_GAP, width: 100, height: 125 });
  });

  it('keeps the spacing it is given', () => {
    const rects = layOut(
      shapes,
      { x: 0, y: 0 },
      { kind: 'grid', columns: 2, cell: 100, gap: 30, crop: '1:1' },
    );
    expect(rects[1].x).toBe(130);
  });

  it('shows cut images whole again when arranged in rows', () => {
    const cut = { ...item('a', 0, 0, 0, 100), imageAspect: 1.5 };
    const other = { ...item('b', 200, 0, 1, 100), imageAspect: 1.5 };
    const arranged = arrangeItems([cut, other], new Set(['a', 'b']), 'rows', 1, { gap: 8 });
    expect(arranged[0].width / arranged[0].height).toBeCloseTo(1.5, 1);
  });
});

describe('swapping', () => {
  it('lets two of the same shape trade places exactly, and puts them in front', () => {
    const items = [item('a', 0, 0, 0), item('b', 300, 0, 1), item('c', 0, 300, 5)];
    const swapped = swapItems(items, 'a', 'b');
    expect(swapped[0]).toMatchObject({ x: 300, y: 0, z: 6 });
    expect(swapped[1]).toMatchObject({ x: 0, y: 0, z: 7 });
    expect(swapped[2]).toBe(items[2]);
  });

  it('fits each into the other place in its own shape', () => {
    const wide = { ...item('wide', 0, 0, 0), width: 200, height: 100 };
    const square = item('square', 500, 0, 1, 100);
    const swapped = swapItems([wide, square], 'wide', 'square');
    expect(swapped[0]).toMatchObject({ x: 500, y: 25, width: 100, height: 50 });
    expect(swapped[1]).toMatchObject({ x: 50, y: 0, width: 100, height: 100 });
  });
});

describe('backgrounds', () => {
  it('are a white sheet of A4 by default, around a middle, and change format keeping their width', () => {
    const sheet = createBackground('s', { x: 0, y: 0 }, 297, -1);
    expect(sheet).toMatchObject({
      kind: 'background',
      color: '#ffffff',
      format: 'A4 portrait',
      z: -1,
    });
    expect(sheet.width).toBeCloseTo(210);
    expect(sheet.x).toBeCloseTo(-105);
    const square = changeBackground(sheet, { format: 'Square', color: 'black' });
    expect(square).toMatchObject({ color: 'black', format: 'Square', x: sheet.x, y: sheet.y });
    expect(square.height).toBeCloseTo(210);
    expect(PAPER_FORMATS[0].name).toBe('A4 portrait');
  });

  it('are taken in by a box only when it holds them wholly', () => {
    const sheet = createBackground('s', { x: 0, y: 0 }, 1000, -1);
    expect(contains({ x: -1000, y: -1000, width: 2000, height: 2000 }, sheet)).toBe(true);
    expect(contains({ x: 0, y: 0, width: 100, height: 100 }, sheet)).toBe(false);
  });
});

describe('a background keeps its layer', () => {
  it('when it is moved or clicked, under what lies on it', () => {
    const sheet = createBackground('s', { x: 0, y: 0 }, 1000, -1);
    const on = item('on', 0, 0, 3);
    const moved = moveItems([sheet, on], new Set(['s', 'on']), 10, 10);
    expect(moved[0]).toMatchObject({ z: -1, x: sheet.x + 10 });
    expect(moved[1].z).toBe(4);
    const items = [sheet, on];
    expect(bringToFront(items, 's')).toBe(items);
  });
});

describe('a sheet over an even grid', () => {
  // A grid of 6 by 6 images of 100, 8 apart: 640 wide, its middle at 320, in a gap
  const grid = Array.from({ length: 36 }, (_, i) =>
    item(`${i}`, (i % 6) * 108, Math.floor(i / 6) * 108, i),
  );

  it('lines its middle up with the middle of the grid', () => {
    const sheet = createBackground('s', { x: 0, y: 0 }, 1000, -1);
    // Its middle 3 off the middle of the grid both ways
    const moving = { ...sheet, x: 320 - sheet.width / 2 + 3, y: 320 - sheet.height / 2 - 3 };
    const group = groupUnder(moving, grid)!;
    expect(group).toEqual({ x: 0, y: 0, width: 640, height: 640 });
    const snapped = snapMove(moving, grid, 0, 0, 5, [group]);
    expect(snapped.dx).toBeCloseTo(-3);
    expect(snapped.dy).toBeCloseTo(3);
    expect(
      snapped.guides.filter((g) => g.kind === 'line' && Math.abs(g.at - 320) < 0.01).length,
    ).toBe(2);
  });

  it('leaves the name of the batch out of the group', () => {
    const sheet = createBackground('s', { x: 320, y: 320 }, 1000, -1);
    const name = createText('t', 'Grid', { x: 0, y: -100 }, 99, measure, 64);
    expect(groupUnder(sheet, [...grid, name])).toEqual({ x: 0, y: 0, width: 640, height: 640 });
  });

  it('is not a group with fewer than two images under it, and leaves backgrounds out', () => {
    const sheet = createBackground('s', { x: 1000, y: 1000 }, 100, -1);
    expect(groupUnder(sheet, grid)).toBeUndefined();
    const other = createBackground('o', { x: 1000, y: 1000 }, 50, -2);
    expect(groupUnder(sheet, [other, item('a', 990, 990, 1, 5)])).toBeUndefined();
  });
});

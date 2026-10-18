import {
  fileNameOfPath,
  foldersOf,
  inspectorPlace,
  keepOnScreen,
  previewPlace,
  ScreenRect,
  visibleFrame,
} from '../common/tag-inspection';

describe('the folders of a tag', () => {
  it('lists each folder once, with how many images are in it, in the order of their paths', () => {
    expect(
      foldersOf([
        'D:\\Shoots\\Spring\\b.jpg',
        'D:\\Shoots\\Autumn\\a.jpg',
        'D:\\Shoots\\Spring\\a.jpg',
        'D:\\Shoots\\shoot 10\\a.jpg',
        'D:\\Shoots\\shoot 9\\a.jpg',
      ]),
    ).toEqual([
      { path: 'D:\\Shoots\\Autumn', count: 1 },
      { path: 'D:\\Shoots\\shoot 9', count: 1 },
      { path: 'D:\\Shoots\\shoot 10', count: 1 },
      { path: 'D:\\Shoots\\Spring', count: 2 },
    ]);
  });

  it('reads both kinds of separator', () => {
    expect(foldersOf(['/photos/a.jpg', '/photos/b.jpg'])).toEqual([{ path: '/photos', count: 2 }]);
    expect(fileNameOfPath('/photos/a.jpg')).toBe('a.jpg');
    expect(fileNameOfPath('C:\\photos\\b.jpg')).toBe('b.jpg');
  });
});

describe('where the inspector and its preview open', () => {
  const fullHd: ScreenRect = { x: 0, y: 0, width: 1920, height: 1040 };
  const within = (rect: ScreenRect, area: ScreenRect) =>
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height;

  it('opens at the top left of the gallery, with the preview on its right, both on the screen', () => {
    const inspector = inspectorPlace({ x: 300, y: 120, width: 1600, height: 900 }, fullHd);
    expect(inspector).toEqual({ x: 316, y: 136, width: 760, height: 640 });
    const preview = previewPlace(inspector, fullHd);
    expect(preview).toEqual({ x: 1076, y: 136, width: 760, height: 640 });
    expect(within(inspector, fullHd) && within(preview, fullHd)).toBe(true);
  });

  it('moves left, and becomes smaller, when the gallery is too far right or the screen too small', () => {
    const far = inspectorPlace({ x: 1500, y: 900, width: 400, height: 100 }, fullHd);
    expect(within(far, fullHd) && within(previewPlace(far, fullHd), fullHd)).toBe(true);
    expect(previewPlace(far, fullHd).x).toBe(far.x + far.width);
    const small: ScreenRect = { x: 0, y: 0, width: 1280, height: 680 };
    const tight = inspectorPlace({ x: 200, y: 100, width: 1000, height: 500 }, small);
    expect(tight.width).toBe(624);
    expect(within(tight, small) && within(previewPlace(tight, small), small)).toBe(true);
  });

  it('works on a second screen, left of the first', () => {
    const left: ScreenRect = { x: -1920, y: 0, width: 1920, height: 1040 };
    const inspector = inspectorPlace({ x: -1700, y: 80, width: 1600, height: 900 }, left);
    expect(within(inspector, left) && within(previewPlace(inspector, left), left)).toBe(true);
  });

  it('puts the preview on the left of an inspector that was moved to the right edge', () => {
    const moved = { x: 1150, y: 100, width: 760, height: 640 };
    expect(previewPlace(moved, fullHd).x).toBe(390);
  });

  it('keeps a window the page placed wrongly on the screen it is on', () => {
    // What a page that was told of a 0 by 0 screen asks for
    const wrong = keepOnScreen({ x: 16, y: 16, width: -16, height: -16 }, fullHd);
    expect(wrong).toEqual({ x: 16, y: 16, width: 360, height: 300 });
    const off = keepOnScreen({ x: 1800, y: 900, width: 760, height: 640 }, fullHd);
    expect(off).toEqual({ x: 1160, y: 400, width: 760, height: 640 });
    expect(keepOnScreen({ x: 0, y: 0, width: 3000, height: 2000 }, fullHd)).toEqual(fullHd);
  });

  it('sizes the preview as what can be seen of the inspector, without the border Windows does not draw', () => {
    // Measured: a 760 by 640 window with a frame, at 100%, on Windows 10
    const inspector = visibleFrame(
      { x: 200, y: 120, width: 760, height: 640 },
      { x: 208, y: 171, width: 744, height: 581 },
    );
    expect(inspector).toEqual({ x: 207, y: 120, width: 746, height: 633 });
    expect(previewPlace(inspector, fullHd)).toEqual({ x: 953, y: 120, width: 746, height: 633 });
    // Without a border that is not drawn (macOS), the bounds as they are
    const mac = { x: 200, y: 120, width: 760, height: 640 };
    expect(visibleFrame(mac, { x: 200, y: 148, width: 760, height: 612 })).toEqual(mac);
  });
});

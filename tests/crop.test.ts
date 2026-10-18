import {
  centeredCrop,
  croppedImage,
  cropFromRow,
  cropOf,
  dragCropHandle,
  frameInShape,
  movePhoto,
  photoRectOf,
  refitCrop,
  zoomPhoto,
} from '../common/crop';
import { arrangeItems, WorkspaceImageItem, workspaceFromRow } from '../common/workspace';

/** A photo of 3:2 shown in a square frame of 100 at 0, 0: the middle of it, by itself */
const square = (crop?: WorkspaceImageItem['crop']): WorkspaceImageItem => ({
  kind: 'image',
  id: 'a',
  fileId: 'a',
  imageAspect: 1.5,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  z: 0,
  crop,
});

const close = (rect: { x: number; y: number; width: number; height: number }) =>
  [rect.x, rect.y, rect.width, rect.height].map((n) => Math.round(n * 1000) / 1000);

describe('crops', () => {
  it('show the middle of the photo by themselves, as the frame has always cut it', () => {
    expect(close(centeredCrop(1.5, 1))).toEqual([0.167, 0, 0.667, 1]);
    expect(close(centeredCrop(1, 2))).toEqual([0, 0.25, 1, 0.5]);
    expect(cropOf(square())).toEqual(centeredCrop(1.5, 1));
  });

  it('place the whole photo around the frame, and make a frame of a part of it', () => {
    const photo = photoRectOf(square());
    expect(close(photo)).toEqual([-25, 0, 150, 100]);
    // The left half of the photo
    const cropped = croppedImage(square(), photo, { x: -25, y: 0, width: 75, height: 100 });
    expect(close(cropped)).toEqual([-25, 0, 75, 100]);
    expect(close(cropped.crop!)).toEqual([0, 0, 0.5, 1]);
    // And back: the photo is where it was
    expect(close(photoRectOf(cropped))).toEqual(close(photo));
  });

  it('size by a handle within the photo, freely or in a shape', () => {
    const photo = { x: 0, y: 0, width: 300, height: 200 };
    const frame = { x: 100, y: 50, width: 100, height: 100 };
    // The right edge, out past the photo: stops at its edge
    expect(dragCropHandle(frame, photo, 'e', 500, 0, 10)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
    // The top left corner, in to less than the smallest
    expect(dragCropHandle(frame, photo, 'nw', 95, 95, 10)).toEqual({
      x: 190,
      y: 140,
      width: 10,
      height: 10,
    });
    // Square, by the bottom right corner: grows in both, the top left stays
    const squared = dragCropHandle(frame, photo, 'se', 40, 10, 10, 1);
    expect(squared).toEqual({ x: 100, y: 50, width: 140, height: 140 });
    // ...but not out of the photo: 150 down is all there is below the top
    expect(dragCropHandle(frame, photo, 'se', 400, 0, 10, 1)).toEqual({
      x: 100,
      y: 50,
      width: 150,
      height: 150,
    });
  });

  it('stay within the photo when the frame reaches its edges', () => {
    // A band across the whole width, at positions whose sums are not exact in floating point
    const photo = { x: 0.1, y: 0, width: 0.2, height: 1 };
    const frame = { x: 0.1, y: 0.3, width: 0.1 + 0.2 - 0.1, height: 0.4 };
    const { crop } = croppedImage(square(), photo, frame);
    expect(crop!.width).toBeLessThanOrEqual(1);
    expect(crop!.x + crop!.width).toBeLessThanOrEqual(1);
    expect(cropFromRow(crop)).toEqual(crop);
    // Stored before that was so: read back, held within the photo
    expect(cropFromRow({ x: 0, y: 0.2, width: 1.0000000000000002, height: 0.5 })).toEqual({
      x: 0,
      y: 0.2,
      width: 1,
      height: 0.5,
    });
    // Held to a shape, with less room left at the edge than the smallest size: still within the photo
    const tight = dragCropHandle(
      { x: 295, y: 50, width: 4, height: 5 },
      { x: 0, y: 0, width: 300, height: 200 },
      'e',
      10,
      0,
      10,
      4 / 5,
    );
    expect(tight.x + tight.width).toBeLessThanOrEqual(300);
  });

  it('move and zoom the photo under the frame, never past its edges', () => {
    const photo = { x: 0, y: 0, width: 300, height: 200 };
    const frame = { x: 100, y: 50, width: 100, height: 100 };
    expect(movePhoto(photo, frame, 500, -500)).toEqual({ x: 100, y: -50, width: 300, height: 200 });
    // Zoomed out more than it can: as small as still covers the frame
    const zoomed = zoomPhoto(photo, frame, 0.1, { x: 150, y: 100 });
    expect(zoomed.height).toBe(100);
    expect(zoomed.width).toBe(150);
  });

  it('change shape around the same middle, within the photo', () => {
    const photo = { x: 0, y: 0, width: 300, height: 200 };
    const wide = frameInShape({ x: 100, y: 50, width: 100, height: 100 }, photo, 16 / 9);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9);
    expect(wide.x + wide.width / 2).toBeCloseTo(150);
    expect(wide.x).toBeGreaterThanOrEqual(0);
  });

  it('keep their middle when an image is laid out in another shape', () => {
    // The right edge of the photo, in a square
    const right = { x: 1 / 3, y: 0, width: 2 / 3, height: 1 };
    expect(refitCrop(undefined, 1.5, 1)).toBeUndefined();
    // Whole again: all of it
    expect(close(refitCrop(right, 1.5, 1.5)!)).toEqual([0, 0, 1, 1]);
    const arranged = arrangeItems([square(right)], new Set(['a']), 'grid', 1, {
      gap: 8,
      crop: '4:5',
    });
    const crop = (arranged[0] as WorkspaceImageItem).crop!;
    expect((crop.width / crop.height) * 1.5).toBeCloseTo(0.8);
    // The same middle, two thirds across
    expect(crop.x + crop.width / 2).toBeCloseTo(2 / 3);
  });

  it('are stored, and read back only when they are crops', () => {
    expect(cropFromRow({ x: 0.1, y: 0, width: 0.5, height: 1 })).toEqual({
      x: 0.1,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(cropFromRow({ x: 2, y: 0, width: 0.5, height: 1 })).toBeUndefined();
    expect(cropFromRow('no')).toBeUndefined();
    const row = workspaceFromRow(
      {
        id: 'w',
        name: 'W',
        index: 0,
        camera: { x: 0, y: 0, zoom: 1 },
        isLocked: false,
        items: [square({ x: 0, y: 0, width: 0.5, height: 1 })],
      },
      () => 10,
    )!;
    expect((row.items[0] as WorkspaceImageItem).crop).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });
});

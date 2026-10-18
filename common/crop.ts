import type { Point, Rect, WorkspaceImageItem } from './workspace';

/**
 * The part of a photo an image on a workspace shows, as fractions of the photo: from 0 to 1 across and
 * down. Its shape is the shape of the image's frame.
 */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest a crop frame can be made, in pixels on the screen while it is sized */
export const MIN_CROP_PIXELS = 24;

/** The shapes a crop can be held to, as width for height; `undefined` is free, `'photo'` the photo's own */
export const CROP_PRESETS: readonly { name: string; aspect: number | 'photo' | undefined }[] = [
  { name: 'Free', aspect: undefined },
  { name: 'Original', aspect: 'photo' },
  { name: '1:1', aspect: 1 },
  { name: '4:5', aspect: 4 / 5 },
  { name: '3:2', aspect: 3 / 2 },
  { name: '16:9', aspect: 16 / 9 },
];

/** The middle of the photo, as large as fits in a frame of `frameAspect`: what an image shows by itself */
export function centeredCrop(imageAspect: number, frameAspect: number): Crop {
  if (frameAspect > imageAspect) {
    // The frame is wider than the photo: all of its width, a band of its height
    const height = imageAspect / frameAspect;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  const width = frameAspect / imageAspect;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

/** The part of its photo an image shows: the crop it was given, or else the middle */
export function cropOf(item: WorkspaceImageItem): Crop {
  return item.crop ?? centeredCrop(item.imageAspect, item.width / item.height);
}

/**
 * A crop for a frame of another shape (an image laid out anew): around the same middle, as large as fits
 * in the photo. Undefined for an image without a crop of its own, which keeps showing the middle.
 */
export function refitCrop(
  crop: Crop | undefined,
  imageAspect: number,
  frameAspect: number,
): Crop | undefined {
  if (crop === undefined) {
    return undefined;
  }
  const middle = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
  const { width, height } = centeredCrop(imageAspect, frameAspect);
  return {
    x: clamp(middle.x - width / 2, 0, 1 - width),
    y: clamp(middle.y - height / 2, 0, 1 - height),
    width,
    height,
  };
}

/** Where the whole photo of an image is on the workspace: larger than its frame where it is cropped */
export function photoRectOf(item: WorkspaceImageItem): Rect {
  const crop = cropOf(item);
  const width = item.width / crop.width;
  const height = item.height / crop.height;
  return { x: item.x - crop.x * width, y: item.y - crop.y * height, width, height };
}

/** The image showing `frame` of its photo, which lies at `photo`: its new place, size and crop */
export function croppedImage(
  item: WorkspaceImageItem,
  photo: Rect,
  frame: Rect,
): WorkspaceImageItem {
  // Kept within the photo: a frame on its edge can come out a hair past it in floating point, and a crop
  // past the photo is dropped when it is read back (`cropFromRow`)
  const width = clamp(frame.width / photo.width, 0, 1);
  const height = clamp(frame.height / photo.height, 0, 1);
  return {
    ...item,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    crop: {
      x: clamp((frame.x - photo.x) / photo.width, 0, 1 - width),
      y: clamp((frame.y - photo.y) / photo.height, 0, 1 - height),
      width,
      height,
    },
  };
}

/** Which edge or corner of a crop frame is dragged: n is the top, w the left */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The frame with one of its edges or corners dragged by `dx, dy`, never outside the photo and never smaller
 * than `minSize`. Held to `aspect` when given: then the edge or corner opposite the handle stays where it
 * is (the middle of it, for an edge).
 */
export function dragCropHandle(
  frame: Rect,
  photo: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  minSize: number,
  aspect?: number,
): Rect {
  const movesLeft = handle.includes('w');
  const movesRight = handle.includes('e');
  const movesTop = handle.includes('n');
  const movesBottom = handle.includes('s');
  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.width;
  let bottom = frame.y + frame.height;
  const photoRight = photo.x + photo.width;
  const photoBottom = photo.y + photo.height;

  if (aspect === undefined) {
    if (movesLeft) {
      left = clamp(left + dx, photo.x, right - minSize);
    }
    if (movesRight) {
      right = clamp(right + dx, left + minSize, photoRight);
    }
    if (movesTop) {
      top = clamp(top + dy, photo.y, bottom - minSize);
    }
    if (movesBottom) {
      bottom = clamp(bottom + dy, top + minSize, photoBottom);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  // In a shape: one size follows from the other. The anchor is what does not move
  const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom);
  const anchorX = movesLeft ? right : movesRight ? left : (left + right) / 2;
  const anchorY = movesTop ? bottom : movesBottom ? top : (top + bottom) / 2;
  let width: number;
  if (isCorner) {
    // The larger of the two moves decides, so the corner follows the pointer
    const byWidth = frame.width + (movesLeft ? -dx : dx);
    const byHeight = (frame.height + (movesTop ? -dy : dy)) * aspect;
    width =
      Math.abs(byWidth - frame.width) >= Math.abs(byHeight - frame.width) ? byWidth : byHeight;
  } else if (movesLeft || movesRight) {
    width = frame.width + (movesLeft ? -dx : dx);
  } else {
    width = (frame.height + (movesTop ? -dy : dy)) * aspect;
  }
  // As far as the photo lets it go from the anchor, in each direction it grows
  const roomX = movesLeft
    ? anchorX - photo.x
    : movesRight
    ? photoRight - anchorX
    : 2 * Math.min(anchorX - photo.x, photoRight - anchorX);
  const roomY = movesTop
    ? anchorY - photo.y
    : movesBottom
    ? photoBottom - anchorY
    : 2 * Math.min(anchorY - photo.y, photoBottom - anchorY);
  // Never past the photo, even where there is less room left than the smallest size
  const largest = Math.min(roomX, roomY * aspect);
  const smallest = Math.min(Math.max(minSize, minSize * aspect), largest);
  width = clamp(width, smallest, largest);
  const height = width / aspect;
  const x = movesLeft ? anchorX - width : movesRight ? anchorX : anchorX - width / 2;
  const y = movesTop ? anchorY - height : movesBottom ? anchorY : anchorY - height / 2;
  return { x, y, width, height };
}

/** The photo moved under the frame by `dx, dy`, but never so far that the frame shows past its edge */
export function movePhoto(photo: Rect, frame: Rect, dx: number, dy: number): Rect {
  return {
    ...photo,
    x: clamp(photo.x + dx, frame.x + frame.width - photo.width, frame.x),
    y: clamp(photo.y + dy, frame.y + frame.height - photo.height, frame.y),
  };
}

/**
 * The photo larger or smaller by `factor` around `at`, but never smaller than the frame: zooming into a
 * photo while cropping
 */
export function zoomPhoto(photo: Rect, frame: Rect, factor: number, at: Point): Rect {
  const smallest = Math.max(frame.width / photo.width, frame.height / photo.height);
  const scale = Math.max(factor, smallest);
  const zoomed = {
    x: at.x - (at.x - photo.x) * scale,
    y: at.y - (at.y - photo.y) * scale,
    width: photo.width * scale,
    height: photo.height * scale,
  };
  // Then back over the frame, should it have slid off it
  return movePhoto(zoomed, frame, 0, 0);
}

/**
 * The frame in another shape: as large as fits in the photo around the middle it had, about as large as it
 * was. A shape of `undefined` leaves it as it is.
 */
export function frameInShape(frame: Rect, photo: Rect, aspect: number | undefined): Rect {
  if (aspect === undefined) {
    return frame;
  }
  const middle = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  // The same area, in the new shape, then made to fit the photo
  const area = frame.width * frame.height;
  let width = Math.sqrt(area * aspect);
  width = Math.min(width, photo.width, photo.height * aspect);
  const height = width / aspect;
  return {
    x: clamp(middle.x - width / 2, photo.x, photo.x + photo.width - width),
    y: clamp(middle.y - height / 2, photo.y, photo.y + photo.height - height),
    width,
    height,
  };
}

/** A crop read back from storage, or undefined when it is not one */
export function cropFromRow(value: unknown): Crop | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { x, y, width, height } = value as Partial<Crop>;
  // A hair outside 0 to 1 is floating point (crops stored before `croppedImage` kept them within), not damage
  const ROUNDING = 1e-6;
  const isFraction = (n: unknown): n is number =>
    typeof n === 'number' && n >= -ROUNDING && n <= 1 + ROUNDING;
  if (!(isFraction(x) && isFraction(y) && isFraction(width) && isFraction(height))) {
    return undefined;
  }
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const w = Math.min(width, 1);
  const h = Math.min(height, 1);
  return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), width: w, height: h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

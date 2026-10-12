import { thumbnailMaxSize } from './config';

/** The formats the browser can decode in a worker. Others keep being shown the way they were */
export const SHARP_DECODABLE = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'avif', 'bmp']);

export interface SharpSize {
  /** In device pixels */
  width: number;
  height: number;
}

/**
 * The size, in device pixels, an image has to be drawn at for a cell of the gallery, or undefined when
 * its thumbnail has enough pixels for it (or when the image itself has no more to give).
 * @param fit Whether the image fills the cell and is cut off (cover), or is shown whole in it (contain)
 * @param fill How much of the cell the image may take up, for the collage that leaves room around it
 */
export function getSharpSize(
  image: { width: number; height: number; extension: string },
  cellWidth: number,
  cellHeight: number,
  fit: 'cover' | 'contain',
  devicePixelRatio: number,
  fill = 1,
): SharpSize | undefined {
  if (!SHARP_DECODABLE.has(image.extension) || !(image.width > 0) || !(image.height > 0)) {
    return undefined;
  }
  const horizontal = (cellWidth * fill) / image.width;
  const vertical = (cellHeight * fill) / image.height;
  // Screen pixels per pixel of the image. Never more than the image has
  const needed = Math.min(
    1,
    (fit === 'cover' ? Math.max(horizontal, vertical) : Math.min(horizontal, vertical)) *
      devicePixelRatio,
  );
  // A small image is its own thumbnail
  const thumbnail = Math.min(1, thumbnailMaxSize / Math.max(image.width, image.height));
  if (needed <= thumbnail * 1.04) {
    return undefined;
  }
  return {
    width: Math.max(1, Math.round(image.width * needed)),
    height: Math.max(1, Math.round(image.height * needed)),
  };
}

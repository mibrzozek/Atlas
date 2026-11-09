import { ClientFile } from '../../entities/File';
import { ThumbnailSize } from '../../stores/UiStore';

export type ContentRect = { width: number; height: number };

export interface GalleryProps {
  contentRect: ContentRect;
  /** The index of the currently selected image, or the "last selected" image when a range is selected */
  lastSelectionIndex: React.MutableRefObject<number | undefined>;
  select: (file: ClientFile, selectAdditive: boolean, selectRange: boolean) => void;
}

/**
 * Where the gallery is in the window, in pixels of the page: the area in the middle with the images (or the
 * message that there are none, or a workspace open over it); undefined while it is not shown
 */
export function galleryRect(): DOMRect | undefined {
  const rect = document.getElementById('content-view')?.getBoundingClientRect();
  return rect !== undefined && rect.width > 0 && rect.height > 0 ? rect : undefined;
}

/** How far in from the gallery's top left corner a window opens there */
const GALLERY_CORNER_GAP = 16;

/** Where a window opens over the gallery: its top left corner, a little in; undefined without a gallery */
export function galleryCorner(): { left: number; top: number } | undefined {
  const rect = galleryRect();
  return rect && { left: rect.left + GALLERY_CORNER_GAP, top: rect.top + GALLERY_CORNER_GAP };
}

/** The smallest and the largest thumbnails, in pixels: the ends of the slider in the View menu */
export const MIN_THUMBNAIL_SIZE = 128;
export const MAX_THUMBNAIL_SIZE = 608;

const PADDING = 8;
const CELL_SIZE_SMALL = 160 + PADDING;
const CELL_SIZE_MEDIUM = 240 + PADDING;
const CELL_SIZE_LARGE = 320 + PADDING;

export function getThumbnailSize(sizeType: ThumbnailSize) {
  if (typeof sizeType === 'number') {
    return sizeType;
  }
  if (sizeType === 'small') {
    return CELL_SIZE_SMALL;
  } else if (sizeType === 'medium') {
    return CELL_SIZE_MEDIUM;
  }
  return CELL_SIZE_LARGE;
}

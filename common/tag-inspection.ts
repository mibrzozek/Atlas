/** A folder that images come from, and how many of them are in it */
export interface FolderCount {
  path: string;
  count: number;
}

/**
 * The folders the files at these paths are in, each once, with how many of the files each holds; in the
 * order of their paths (letters before case, as Explorer sorts them). Both kinds of separator are known,
 * so a path stored on Windows reads the same as one stored on macOS or Linux.
 */
export function foldersOf(paths: readonly string[]): FolderCount[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const end = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const folder = end > 0 ? path.slice(0, end) : path;
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }),
    );
}

/** The name of a file, without the folders it is in */
export function fileNameOfPath(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** A place on the screen, in pixels of the system (as windows are placed) */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How large the inspector of a tag opens, and its preview with it, at most */
export const INSPECTOR_SIZE = { width: 760, height: 640 };
/** Room kept from the edges of the screen and of the gallery */
const SCREEN_MARGIN = 16;

/**
 * Where the inspector of a tag opens: at the top left of the gallery, and small enough that the preview,
 * which is as large, fits on its right; both within the work area of the screen (without the taskbar)
 */
export function inspectorPlace(gallery: ScreenRect, workArea: ScreenRect): ScreenRect {
  const width = Math.min(
    INSPECTOR_SIZE.width,
    Math.floor((workArea.width - 2 * SCREEN_MARGIN) / 2),
  );
  const height = Math.min(INSPECTOR_SIZE.height, workArea.height - 2 * SCREEN_MARGIN);
  const right = workArea.x + workArea.width - SCREEN_MARGIN;
  const bottom = workArea.y + workArea.height - SCREEN_MARGIN;
  return {
    x: Math.round(clamp(gallery.x + SCREEN_MARGIN, workArea.x + SCREEN_MARGIN, right - 2 * width)),
    y: Math.round(clamp(gallery.y + SCREEN_MARGIN, workArea.y + SCREEN_MARGIN, bottom - height)),
    width,
    height,
  };
}

/**
 * Where the preview opens beside the inspector (which may have been moved since): as large as it, on its
 * right, or on its left when there is no room on the right; within the work area of the screen
 */
export function previewPlace(inspector: ScreenRect, workArea: ScreenRect): ScreenRect {
  const width = Math.min(inspector.width, workArea.width);
  const height = Math.min(inspector.height, workArea.height);
  const onRight = inspector.x + inspector.width;
  const fitsRight = onRight + width <= workArea.x + workArea.width;
  return {
    x: Math.round(
      clamp(
        fitsRight ? onRight : inspector.x - width,
        workArea.x,
        workArea.x + workArea.width - width,
      ),
    ),
    y: Math.round(clamp(inspector.y, workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

/**
 * A place made to lie wholly in the work area of a screen: smaller where it is larger, moved in where it
 * sticks out. What the page asked for may be wrong (a screen it was told of that is not there, or 0 by 0)
 */
export function keepOnScreen(place: ScreenRect, workArea: ScreenRect): ScreenRect {
  const width = Math.min(Math.max(place.width, INSPECTOR_MIN_SIZE.width), workArea.width);
  const height = Math.min(Math.max(place.height, INSPECTOR_MIN_SIZE.height), workArea.height);
  return {
    x: Math.round(clamp(place.x, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(place.y, workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}
const INSPECTOR_MIN_SIZE = { width: 360, height: 300 };

/**
 * What can be seen of a window with a frame, from its bounds and those of its page. On Windows the bounds
 * include a border that is not drawn, on the left, right and bottom: all of the frame there but its one
 * visible pixel. Elsewhere the frame is all visible, and this is the bounds
 */
export function visibleFrame(bounds: ScreenRect, page: ScreenRect): ScreenRect {
  const side = Math.max(0, page.x - bounds.x - 1);
  const bottom = Math.max(0, bounds.y + bounds.height - (page.y + page.height) - 1);
  return {
    x: bounds.x + side,
    y: bounds.y,
    width: bounds.width - 2 * side,
    height: bounds.height - bottom,
  };
}

/** As `window.open` takes a place: "left=..,top=..,width=..,height=.." */
export function windowFeatures(place: ScreenRect): string {
  return `left=${place.x},top=${place.y},width=${place.width},height=${place.height}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

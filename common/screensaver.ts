export interface ScreensaverSettings {
  isEnabled: boolean;
  /** How long the system has to be idle before the screensaver starts */
  idleMinutes: number;
  /** How long every image is shown */
  secondsPerImage: number;
  /**
   * Whether it only starts while Atlas is the window being used. Off by default: it then starts whenever
   * Atlas is open, whichever application was used last.
   */
  onlyWhenInFront: boolean;
}

export const DEFAULT_SCREENSAVER_SETTINGS: ScreensaverSettings = {
  isEnabled: true,
  idleMinutes: 5,
  secondsPerImage: 8,
  onlyWhenInFront: false,
};

export const SCREENSAVER_LIMITS = {
  idleMinutes: { min: 1, max: 240 },
  secondsPerImage: { min: 2, max: 600 },
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

export function clampIdleMinutes(value: unknown): number {
  const { min, max } = SCREENSAVER_LIMITS.idleMinutes;
  return clampNumber(value, min, max, DEFAULT_SCREENSAVER_SETTINGS.idleMinutes);
}

export function clampSecondsPerImage(value: unknown): number {
  const { min, max } = SCREENSAVER_LIMITS.secondsPerImage;
  return clampNumber(value, min, max, DEFAULT_SCREENSAVER_SETTINGS.secondsPerImage);
}

export interface IdleState {
  /** How long there has been no mouse or keyboard input in any application */
  systemIdleSeconds: number;
  /** Whether the main window is open: visible and not minimized (to the taskbar or the tray) */
  isWindowOpen: boolean;
  /** Whether the main window is the one in use: open, and the one with the focus */
  isWindowInFront: boolean;
  /** Whether the computer is locked: nothing is to be shown on the lock screen */
  isLocked: boolean;
}

/** After this little time without input, the computer is being used: the screensaver ends */
export const SCREENSAVER_WAKE_IDLE_SECONDS = 2;

/** A monitor the screensaver can cover */
export interface ScreensaverDisplay {
  id: number;
  /** Where it is among the other monitors */
  x: number;
  y: number;
  /** Whether it is the monitor the main window is on */
  isCurrent: boolean;
}

/**
 * The windows of the screensaver are opened by the main window with this name plus the id of a monitor.
 * The main process recognises them by it, and puts each over its monitor, above everything else.
 */
export const SCREENSAVER_WINDOW_PREFIX = 'screensaver-';

/**
 * The screensaver starts when the computer has not been used for long enough while Atlas is open.
 * It used to require Atlas to be the window in front, so as not to cover a video playing in another
 * application; but then it did not start whenever something else had been clicked last, which is most
 * of the time. That is now a setting (`onlyWhenInFront`).
 */
export function shouldStartScreensaver(
  settings: ScreensaverSettings,
  idle: IdleState,
  isAlreadyRunning: boolean,
): boolean {
  return (
    settings.isEnabled &&
    !isAlreadyRunning &&
    !idle.isLocked &&
    idle.isWindowOpen &&
    (idle.isWindowInFront || !settings.onlyWhenInFront) &&
    idle.systemIdleSeconds >= settings.idleMinutes * 60
  );
}

/** Returns the items in a random order, without changing the given list */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** An image of the screensaver */
export interface ScreensaverImage {
  id: string;
  /**
   * The file that is decoded for it: the image itself when the browser can read it, so that it can be drawn
   * at exactly the size it gets on screen. Its thumbnail otherwise.
   */
  src: string;
  /** Decoded instead when `src` cannot be, e.g. its thumbnail */
  fallbackSrc?: string;
  /** Width divided by height, as the image is displayed */
  aspectRatio: number;
  /** The same for files that are copies of each other: only one of them is shown */
  duplicateKey?: string;
}

/** Leaves out images that are in the list twice, and files that are a copy of one that is already in it */
export function withoutDuplicates(images: readonly ScreensaverImage[]): ScreensaverImage[] {
  const ids = new Set<string>();
  const copies = new Set<string>();
  const result: ScreensaverImage[] = [];
  for (const image of images) {
    if (ids.has(image.id) || (image.duplicateKey !== undefined && copies.has(image.duplicateKey))) {
      continue;
    }
    ids.add(image.id);
    if (image.duplicateKey !== undefined) {
      copies.add(image.duplicateKey);
    }
    result.push(image);
  }
  return result;
}

/**
 * Hands out the images to show, to all screens together.
 * An image that is on a screen is never handed out a second time, and of the others it picks one of those
 * that have not been shown for the longest time: an image only comes back after about all the others have
 * had their turn, in an order that is different every round.
 */
export class ImagePool<T extends { id: string }> {
  private readonly items: T[];
  private readonly inUse = new Set<string>();
  /** A counter that goes up with every image that is handed back: when it was last on screen */
  private readonly lastShown = new Map<string, number>();
  private clock = 0;

  constructor(items: readonly T[], private readonly random: () => number = Math.random) {
    this.items = shuffled(items, random);
  }

  get size(): number {
    return this.items.length;
  }

  /** How many images are not on a screen */
  get freeCount(): number {
    return this.items.length - this.inUse.size;
  }

  /** Returns an image that is not in use and marks it as in use, or undefined when all of them are */
  take(): T | undefined {
    const free = this.items.filter((item) => !this.inUse.has(item.id));
    if (free.length === 0) {
      return undefined;
    }
    // Longest ago first. Sorting is stable, so images that were never shown stay in their shuffled order
    free.sort((a, b) => (this.lastShown.get(a.id) ?? -1) - (this.lastShown.get(b.id) ?? -1));
    // Some choice, for a different order every round, but only among the ones whose turn it is
    const choices = Math.max(1, Math.floor(free.length / 4));
    const item = free[Math.min(choices - 1, Math.floor(this.random() * choices))];
    this.inUse.add(item.id);
    return item;
  }

  /** The image is no longer on screen */
  release(item: T): void {
    if (this.inUse.delete(item.id)) {
      this.lastShown.set(item.id, ++this.clock);
    }
  }

  /** The image was taken but not shown after all: it keeps its turn */
  putBack(item: T): void {
    this.inUse.delete(item.id);
  }

  /** The image cannot be shown: it is never handed out again */
  remove(item: T): void {
    this.inUse.delete(item.id);
    this.lastShown.delete(item.id);
    const index = this.items.findIndex((other) => other.id === item.id);
    if (index !== -1) {
      this.items.splice(index, 1);
    }
  }
}

/** A rectangle whose edges are on whole device pixels, so that what is drawn in it is not blurred */
export interface PixelRect {
  /** In CSS pixels */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The size in device pixels: whole numbers */
  pixelWidth: number;
  pixelHeight: number;
}

/** Moves the edges of a rectangle to the nearest device pixels. Rectangles that touched keep touching */
export function snapToDevicePixels(
  rect: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number,
): PixelRect {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const left = Math.round(rect.x * dpr);
  const top = Math.round(rect.y * dpr);
  const pixelWidth = Math.max(1, Math.round((rect.x + rect.width) * dpr) - left);
  const pixelHeight = Math.max(1, Math.round((rect.y + rect.height) * dpr) - top);
  return {
    x: left / dpr,
    y: top / dpr,
    width: pixelWidth / dpr,
    height: pixelHeight / dpr,
    pixelWidth,
    pixelHeight,
  };
}

/**
 * The size, in whole device pixels, at which an image has to be drawn to fill a frame of the given size
 * without being distorted, and where it goes in that frame: centred, with what does not fit cut off.
 */
export function coverPixels(
  frameWidth: number,
  frameHeight: number,
  aspectRatio: number,
): { width: number; height: number; left: number; top: number } {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1.5;
  let width = frameWidth;
  let height = Math.round(frameWidth / ratio);
  if (height < frameHeight) {
    height = frameHeight;
    width = Math.max(frameWidth, Math.round(frameHeight * ratio));
  }
  return {
    width,
    height,
    left: -Math.floor((width - frameWidth) / 2),
    top: -Math.floor((height - frameHeight) / 2),
  };
}

/** How the images are presented on one screen */
export type ScreenPlan =
  // A wall of images in this many rows or columns, that moves one image at a time
  | { mode: 'wall'; laneCount: number }
  // A few large images at a time, shown whole: for when there are not enough images for a wall
  | { mode: 'showcase'; groupSize: number };

/**
 * A wall only moves when there are images that are not on it. With fewer than this many times what fits
 * on the screens, the same images would come back right after they left.
 */
export const WALL_SPARE_FACTOR = 1.5;
/** At most this many images next to each other in a showcase */
export const MAX_SHOWCASE_GROUP = 3;

/** About how many images a wall with this many lanes shows */
export function estimateWallCount(
  orientation: LaneOrientation,
  laneCount: number,
  width: number,
  height: number,
  gap: number,
  meanAspectRatio: number,
): number {
  const isRows = orientation === 'rows';
  const laneLength = isRows ? width : height;
  const crossLength = isRows ? height : width;
  const thickness = (crossLength - (laneCount + 1) * gap) / laneCount;
  const ratio = Number.isFinite(meanAspectRatio) && meanAspectRatio > 0 ? meanAspectRatio : 1.5;
  const itemLength = isRows ? thickness * ratio : thickness / ratio;
  if (!(thickness > 0) || !(itemLength > 0)) {
    return 0;
  }
  return Math.max(laneCount, Math.ceil((laneCount * (laneLength - gap)) / (itemLength + gap)));
}

/**
 * Decides what every screen shows, for the number of images there is to show.
 * Plenty of images: the usual wall. Fewer: walls with fewer, larger rows. Only several: a showcase.
 * @param singleImage Always one large image per screen, whatever the number of images
 */
export function planScreens(
  screens: readonly { width: number; height: number }[],
  imageCount: number,
  meanAspectRatio: number,
  orientation: LaneOrientation,
  gap: number,
  singleImage = false,
): ScreenPlan[] {
  if (singleImage) {
    return screens.map(() => ({ mode: 'showcase', groupSize: 1 }));
  }
  const minLanes = orientation === 'rows' ? 2 : 3;
  const usual = screens.map((screen) => getLaneCount(orientation, screen.width));
  for (let fewer = 0; fewer <= Math.max(0, ...usual) - minLanes; fewer++) {
    const laneCounts = usual.map((count) => Math.max(minLanes, count - fewer));
    const shown = screens.reduce(
      (sum, screen, i) =>
        sum +
        estimateWallCount(
          orientation,
          laneCounts[i],
          screen.width,
          screen.height,
          gap,
          meanAspectRatio,
        ),
      0,
    );
    if (shown * WALL_SPARE_FACTOR <= imageCount) {
      return laneCounts.map((laneCount) => ({ mode: 'wall', laneCount }));
    }
  }
  // One image is kept aside, so that there is something to change to
  const perScreen = Math.floor((imageCount - 1) / Math.max(1, screens.length));
  const groupSize = Math.min(MAX_SHOWCASE_GROUP, Math.max(1, perScreen));
  return screens.map(() => ({ mode: 'showcase', groupSize }));
}

/**
 * Lays out a few images next to each other, each shown whole and as large as the screen allows.
 * Of the given images as many are used as fit without making them much smaller: a landscape image
 * usually fills a screen on its own, two or three portraits fit side by side.
 * @returns A rectangle for each image that is used, in order
 */
export function layoutShowcase(
  aspectRatios: readonly number[],
  width: number,
  height: number,
  margin: number,
  gap: number,
): { x: number; y: number; width: number; height: number }[] {
  const maxHeight = height - 2 * margin;
  const ratios = aspectRatios.map((r) => (Number.isFinite(r) && r > 0 ? r : 1.5));
  if (ratios.length === 0 || !(maxHeight > 0) || !(width - 2 * margin > 0)) {
    return [];
  }
  const heightFor = (count: number) => {
    const ratioSum = ratios.slice(0, count).reduce((sum, r) => sum + r, 0);
    return Math.min(maxHeight, (width - 2 * margin - (count - 1) * gap) / ratioSum);
  };
  let count = 1;
  // One more, as long as that costs little of their size
  while (count < ratios.length && heightFor(count + 1) >= 0.8 * maxHeight) {
    count++;
  }
  const rowHeight = heightFor(count);
  const rowWidth =
    ratios.slice(0, count).reduce((sum, r) => sum + r * rowHeight, 0) + (count - 1) * gap;
  let x = (width - rowWidth) / 2;
  const y = (height - rowHeight) / 2;
  return ratios.slice(0, count).map((ratio) => {
    const rect = { x, y, width: ratio * rowHeight, height: rowHeight };
    x += rect.width + gap;
    return rect;
  });
}

/**
 * The images are laid out in lanes: rows next to each other from left to right (like the horizontal masonry
 * view), or columns from top to bottom (like the vertical masonry view).
 */
export type LaneOrientation = 'rows' | 'columns';

export interface LaneLayoutOptions {
  orientation: LaneOrientation;
  laneCount: number;
  /** The size of the screen in the direction the lanes run: the width for rows, the height for columns */
  laneLength: number;
  /** The size of the screen across the lanes: the height for rows, the width for columns */
  crossLength: number;
  /** The space between images, and around all of them */
  gap: number;
}

export interface LanePlacement {
  /** The position in the endless sequence of images */
  sequenceIndex: number;
  lane: number;
  /** In pixels, from the left and the top of the screen */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The images of a lane, and the sum of how long each is compared to how thick the lane is */
interface Lane {
  first: number;
  count: number;
  ratioSum: number;
}

/**
 * To make the lanes reach all edges of the screen, the tiles may differ this much from the shape of their
 * image, which hides a sliver of it along two of its sides. Beyond this, a margin is left instead.
 */
export const MAX_TILE_TRIM = 0.06;

/**
 * Lays out the sequence of images starting at the given position like the masonry view of the gallery does:
 * in lanes that run from one edge of the screen to the other, with the same space between all images.
 * A lane that holds more images is thinner. How many images go in every lane is picked such that the lanes
 * together fill the screen as well as possible; what is left is made up for by making all lanes a little
 * thicker or thinner (see `MAX_TILE_TRIM`).
 * @param aspectRatioAt Returns width divided by height for a position in the sequence
 */
export function layoutLanes(
  aspectRatioAt: (sequenceIndex: number) => number,
  startIndex: number,
  { orientation, laneCount, laneLength, crossLength, gap }: LaneLayoutOptions,
): LanePlacement[] {
  const isRows = orientation === 'rows';
  // How much there is to fill: along the lanes, and across all of them together
  const maxLength = laneLength - 2 * gap;
  const crossAvailable = crossLength - (laneCount + 1) * gap;
  if (laneCount < 1 || !(maxLength > 0) || !(crossAvailable > 0)) {
    return [];
  }
  const targetThickness = crossAvailable / laneCount;

  // How long an image is along its lane, for a lane with a thickness of 1
  const ratioAt = (sequenceIndex: number) => {
    const aspectRatio = aspectRatioAt(sequenceIndex);
    const safe = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1.5;
    return isRows ? safe : 1 / safe;
  };
  const thicknessOf = (lane: Lane, length: number) =>
    (length - (lane.count - 1) * gap) / lane.ratioSum;

  // A lane can hold one image more or less than what comes closest to its share of the screen:
  // try the combinations, and keep the one that fills the screen best with lanes of about the same thickness
  let best: { lanes: Lane[]; difference: number } | undefined;
  const fill = (lanes: Lane[], first: number, crossUsed: number) => {
    if (lanes.length === laneCount) {
      const unevenness = lanes.reduce(
        (sum, l) => sum + Math.abs(thicknessOf(l, maxLength) - targetThickness),
        0,
      );
      // Filling the screen matters most: that decides how much of the images has to be trimmed
      const difference = 3 * Math.abs(crossUsed - crossAvailable) + unevenness;
      if (best === undefined || difference < best.difference) {
        best = { lanes: lanes.slice(), difference };
      }
      return;
    }
    // Add images until the lane is no thicker than its share
    const lane: Lane = { first, count: 0, ratioSum: 0 };
    let previous: Lane | undefined;
    while (lane.count < 100) {
      lane.ratioSum += ratioAt(first + lane.count);
      lane.count++;
      if (thicknessOf(lane, maxLength) <= targetThickness) {
        break;
      }
      previous = { ...lane };
    }
    for (const candidate of previous !== undefined ? [previous, { ...lane }] : [{ ...lane }]) {
      lanes.push(candidate);
      fill(lanes, first + candidate.count, crossUsed + thicknessOf(candidate, maxLength));
      lanes.pop();
    }
  };
  fill([], startIndex, 0);
  if (best === undefined) {
    return [];
  }
  const { lanes } = best as { lanes: Lane[] };

  // The lanes run from edge to edge. Together they are rarely exactly as thick as the screen:
  // they are all made a little thicker or thinner so that they are
  const naturalCross = lanes.reduce((sum, l) => sum + thicknessOf(l, maxLength), 0);
  const stretch = Math.min(
    1 + MAX_TILE_TRIM,
    Math.max(1 - MAX_TILE_TRIM, crossAvailable / naturalCross),
  );
  // In the middle of the screen, for when that was not enough
  let crossOffset = gap + (crossAvailable - naturalCross * stretch) / 2;

  const placements: LanePlacement[] = [];
  lanes.forEach((lane, laneIndex) => {
    const naturalThickness = thicknessOf(lane, maxLength);
    const thickness = naturalThickness * stretch;
    let offset = gap;
    for (let i = 0; i < lane.count; i++) {
      const sequenceIndex = lane.first + i;
      const itemLength = naturalThickness * ratioAt(sequenceIndex);
      placements.push(
        isRows
          ? {
              sequenceIndex,
              lane: laneIndex,
              x: offset,
              y: crossOffset,
              width: itemLength,
              height: thickness,
            }
          : {
              sequenceIndex,
              lane: laneIndex,
              x: crossOffset,
              y: offset,
              width: thickness,
              height: itemLength,
            },
      );
      offset += itemLength + gap;
    }
    crossOffset += thickness + gap;
  });
  return placements;
}

/** How many rows or columns to use for a screen of the given size */
export function getLaneCount(orientation: LaneOrientation, width: number): number {
  // Always three rows. The number of columns depends on how wide the screen is
  return orientation === 'rows' ? 3 : Math.min(8, Math.max(3, Math.round(width / 420)));
}

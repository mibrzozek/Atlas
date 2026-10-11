export interface ScreensaverSettings {
  isEnabled: boolean;
  /** How long the system has to be idle before the screensaver starts */
  idleMinutes: number;
  /** How long every image is shown */
  secondsPerImage: number;
}

export const DEFAULT_SCREENSAVER_SETTINGS: ScreensaverSettings = {
  isEnabled: true,
  idleMinutes: 5,
  secondsPerImage: 8,
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
  /** Whether the main window is the one in use: visible, not minimized and focused */
  isWindowActive: boolean;
}

/**
 * The screensaver only takes over the screen when Atlas is the application in front,
 * so it does not cover a video or anything else that is running in another window.
 */
export function shouldStartScreensaver(
  settings: ScreensaverSettings,
  idle: IdleState,
  isAlreadyRunning: boolean,
): boolean {
  return (
    settings.isEnabled &&
    !isAlreadyRunning &&
    idle.isWindowActive &&
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
  /** What is shown: the thumbnail when there is one, since many are on screen at once */
  src: string;
  /** Shown instead when `src` cannot be loaded, e.g. when the thumbnail was not generated yet */
  fallbackSrc?: string;
  /** Width divided by height, as the image is displayed */
  aspectRatio: number;
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

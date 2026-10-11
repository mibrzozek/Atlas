import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { encodeFilePath } from 'common/fs';
import {
  LaneOrientation,
  ScreensaverImage,
  getLaneCount,
  layoutLanes,
  shouldStartScreensaver,
  shuffled,
} from 'common/screensaver';
import { RendererMessenger } from '../../ipc/renderer';
import { useStore } from '../contexts/StoreContext';
import { ViewMethod } from '../stores/UiStore';

/** How often is checked whether the system has been idle for long enough */
const IDLE_CHECK_INTERVAL = 5000;
/** Entering full-screen moves things underneath the pointer: ignore the mouse for a moment */
const WAKE_GRACE_PERIOD = 1500;
/** The pointer has to move this many pixels to wake up: a nudge of the desk should not */
const WAKE_MOVE_DISTANCE = 12;

/** The space between the images, in pixels: the same as in the gallery */
const GAP = 8;
// A step: the image in the corner slowly fades away, then the others move up to fill its place.
// Keep in sync with the durations in screensaver.scss
const FADE_DURATION = 1800;
const MOVE_DELAY = 1800;
const MOVE_DURATION = 1400;
const STEP_DURATION = Math.max(FADE_DURATION, MOVE_DELAY + MOVE_DURATION);

/**
 * Starts the screensaver when the system has been idle for long enough,
 * and shows the images of the home gallery until the mouse or keyboard is used.
 */
const Screensaver = observer(() => {
  const { uiStore, fileStore } = useStore();
  const { isScreensaverActive, isScreensaverEnabled, screensaverIdleMinutes } = uiStore;

  useEffect(() => {
    if (!isScreensaverEnabled || isScreensaverActive) {
      return;
    }
    const handle = window.setInterval(async () => {
      try {
        const idle = await RendererMessenger.getIdleState();
        const settings = runInAction(() => uiStore.screensaverSettings);
        if (shouldStartScreensaver(settings, idle, uiStore.isScreensaverActive)) {
          uiStore.startScreensaver();
        }
      } catch (e) {
        console.error('Could not check whether the system is idle', e);
      }
    }, IDLE_CHECK_INTERVAL);
    return () => window.clearInterval(handle);
  }, [uiStore, isScreensaverEnabled, isScreensaverActive, screensaverIdleMinutes]);

  // The images are collected when it starts, whatever is being shown in the gallery at that moment
  const [images, setImages] = useState<ScreensaverImage[]>();
  useEffect(() => {
    if (!isScreensaverActive) {
      setImages(undefined);
      return;
    }
    let isEffectRunning = true;
    fileStore
      .fetchHomeGalleryImages()
      .then((homeImages) => {
        if (!isEffectRunning) {
          return;
        }
        if (homeImages.length === 0) {
          // Nothing to show: an empty black screen would look like something is broken
          uiStore.stopScreensaver();
        } else {
          setImages(shuffled(homeImages));
        }
      })
      .catch((e) => {
        console.error('Could not load the images of the screensaver', e);
        uiStore.stopScreensaver();
      });
    return () => {
      isEffectRunning = false;
    };
  }, [fileStore, uiStore, isScreensaverActive]);

  // Take over the whole screen while it is running, and put the window back the way it was afterwards
  useEffect(() => {
    if (!isScreensaverActive) {
      return;
    }
    RendererMessenger.setScreensaverMode(true);
    return () => {
      RendererMessenger.setScreensaverMode(false);
    };
  }, [isScreensaverActive]);

  // Wake up on any use of the mouse or keyboard
  useEffect(() => {
    if (!isScreensaverActive) {
      return;
    }
    const startedAt = performance.now();
    let origin: { x: number; y: number } | undefined;
    const wake = () => uiStore.stopScreensaver();
    const handleMove = (e: MouseEvent) => {
      if (performance.now() - startedAt < WAKE_GRACE_PERIOD) {
        return;
      }
      if (origin === undefined) {
        origin = { x: e.screenX, y: e.screenY };
      } else if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > WAKE_MOVE_DISTANCE) {
        wake();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      wake();
    };
    // While it is on top of everything, switching to another application has to end it as well
    const handleBlur = () => {
      if (performance.now() - startedAt > WAKE_GRACE_PERIOD) {
        wake();
      }
    };
    // Capturing, so that the key or click that wakes it up does not also do something in the gallery underneath
    window.addEventListener('mousemove', handleMove, true);
    window.addEventListener('mousedown', wake, true);
    window.addEventListener('wheel', wake, true);
    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('mousemove', handleMove, true);
      window.removeEventListener('mousedown', wake, true);
      window.removeEventListener('wheel', wake, true);
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [uiStore, isScreensaverActive]);

  if (!isScreensaverActive) {
    return null;
  }
  // Like the layout of the gallery: columns for the vertical masonry view, rows for the others
  const orientation: LaneOrientation =
    uiStore.method === ViewMethod.MasonryVertical ? 'columns' : 'rows';
  return (
    <div id="screensaver" role="presentation">
      {images !== undefined && (
        <ImageWall
          images={images}
          orientation={orientation}
          secondsPerStep={uiStore.screensaverSecondsPerImage}
        />
      )}
    </div>
  );
});

export default Screensaver;

type TilePhase =
  // Shown for the first time, together with all the others
  | 'appearing'
  // Came in from the end of its lane
  | 'entering'
  | 'shown'
  // The first image of all: fades away where it is
  | 'fading'
  // Moves out of the start of its lane, while it comes in at the end of the lane before it
  | 'leaving';

interface Tile {
  key: string;
  sequenceIndex: number;
  lane: number;
  image: ScreensaverImage;
  x: number;
  y: number;
  width: number;
  height: number;
  phase: TilePhase;
  /** Where it comes from when entering */
  enterX: number;
  enterY: number;
  /** When it can be removed, for the ones that are on their way out */
  removeAt?: number;
}

interface ImageWallProps {
  images: ScreensaverImage[];
  orientation: LaneOrientation;
  secondsPerStep: number;
}

/**
 * Fills the screen with images, and lets them move through it like a snake: the first image fades away,
 * the others of its lane move up, the first image of every next lane comes in at the end of the lane
 * before it, and an image that was not shown yet comes in at the very end.
 */
const ImageWall = ({ images, orientation, secondsPerStep }: ImageWallProps) => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    // The window still has to become full-screen when this is first shown
    const handleResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [tiles, setTiles] = useState<Tile[]>([]);
  const startIndex = useRef(0);

  useEffect(() => {
    const { width, height } = size;
    const isRows = orientation === 'rows';
    const layout = (start: number) =>
      layoutLanes((i) => images[i % images.length].aspectRatio, start, {
        orientation,
        laneCount: getLaneCount(orientation, width),
        laneLength: isRows ? width : height,
        crossLength: isRows ? height : width,
        gap: GAP,
      });

    const toTile = (p: ReturnType<typeof layout>[number], phase: TilePhase): Tile => ({
      ...p,
      key: `${p.sequenceIndex}:${p.lane}`,
      image: images[p.sequenceIndex % images.length],
      phase,
      // From just outside the screen, at the end of its lane
      enterX: isRows ? width + GAP : p.x,
      enterY: isRows ? p.y : height + GAP,
    });

    setTiles(layout(startIndex.current).map((p) => toTile(p, 'appearing')));

    const step = () => {
      const firstIndex = startIndex.current;
      startIndex.current++;
      const placements = layout(startIndex.current);
      const now = performance.now();
      setTiles((previous) => {
        const placementOf = new Map(placements.map((p) => [`${p.sequenceIndex}:${p.lane}`, p]));
        const next: Tile[] = [];
        // The tiles keep their order, and new ones are added at the end: an element that is moved to
        // another place in the page loses its running animation, and would jump instead of fade
        for (const tile of previous) {
          const placement = placementOf.get(tile.key);
          if (tile.removeAt !== undefined) {
            // Already on its way out
            if (tile.removeAt > now) {
              next.push(tile);
            }
          } else if (placement !== undefined) {
            placementOf.delete(tile.key);
            next.push({ ...tile, ...placement, phase: 'shown' });
          } else {
            const isFirst = tile.sequenceIndex === firstIndex;
            next.push({
              ...tile,
              phase: isFirst ? 'fading' : 'leaving',
              // Out of the start of its lane
              x: isFirst || !isRows ? tile.x : -tile.width - GAP,
              y: isFirst || isRows ? tile.y : -tile.height - GAP,
              removeAt: now + STEP_DURATION,
            });
          }
        }
        for (const placement of placementOf.values()) {
          next.push(toTile(placement, 'entering'));
        }
        return next;
      });
    };

    // Not faster than the animation of a single step takes
    const interval = Math.max(secondsPerStep * 1000, STEP_DURATION + 400);
    // Without enough images to fill more than the screen there is nothing to move through
    const canMove = images.length > layout(0).length;
    const handle = canMove ? window.setInterval(step, interval) : undefined;
    return () => window.clearInterval(handle);
  }, [images, orientation, secondsPerStep, size]);

  return (
    <>
      {tiles.map((tile) => (
        <ImageTile key={tile.key} tile={tile} />
      ))}
    </>
  );
};

const ImageTile = ({ tile }: { tile: Tile }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState(tile.image.src);
  const transform = `translate3d(${tile.x}px, ${tile.y}px, 0)`;

  // An entering image starts outside of the screen and moves in from there,
  // the images that are there from the start fade in
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || (tile.phase !== 'entering' && tile.phase !== 'appearing')) {
      return;
    }
    element.style.transition = 'none';
    if (tile.phase === 'entering') {
      element.style.transform = `translate3d(${tile.enterX}px, ${tile.enterY}px, 0)`;
    } else {
      element.style.opacity = '0';
    }
    // Makes the browser apply the starting state before the real one is set again
    element.getBoundingClientRect();
    element.style.transition = '';
    element.style.transform = transform;
    element.style.opacity = '';
    // Only when it is added
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="screensaver-tile"
      data-phase={tile.phase}
      style={{ transform, width: tile.width, height: tile.height }}
    >
      <img
        src={encodeFilePath(src)}
        alt=""
        decoding="async"
        onError={() => {
          if (tile.image.fallbackSrc !== undefined && src !== tile.image.fallbackSrc) {
            setSrc(tile.image.fallbackSrc);
          }
        }}
      />
    </div>
  );
};

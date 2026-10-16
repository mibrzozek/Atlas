import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';

import {
  LaneOrientation,
  SCREENSAVER_WAKE_IDLE_SECONDS,
  shouldStartScreensaver,
  withoutDuplicates,
} from 'common/screensaver';
import { RendererMessenger } from '../../ipc/renderer';
import { AppToaster } from '../components/Toaster';
import { useStore } from '../contexts/StoreContext';
import { ScreensaverDirector } from '../screensaver/director';
import { closeScreens, openScreens } from '../screensaver/screens';
import { ScreenSurface } from '../screensaver/tile';
import { ViewMethod } from '../stores/UiStore';

/** How often is checked whether the system has been idle for long enough */
const IDLE_CHECK_INTERVAL = 5000;
/** Windows that appear underneath the pointer make it "move": ignore the mouse for a moment */
const WAKE_GRACE_PERIOD = 1500;
/** The pointer has to move this many pixels to wake up: a nudge of the desk should not */
const WAKE_MOVE_DISTANCE = 12;

/**
 * Starts the screensaver when the system has been idle for long enough, and shows the images of the home
 * gallery (or of the tags picked in the settings) on every monitor until the mouse or keyboard is used.
 *
 * It draws nothing in the main window. Every monitor gets a window of its own on top of everything
 * (`screensaver/screens.ts`), which `ScreensaverDirector` fills. The main window is not resized or made
 * full-screen, so ending it is just closing those windows.
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

  useEffect(() => {
    if (!isScreensaverActive) {
      return;
    }
    let isRunning = true;
    let surfaces: ScreenSurface[] = [];
    let director: ScreensaverDirector | undefined;
    const stopListening: (() => void)[] = [];
    const wake = () => uiStore.stopScreensaver();

    // Wake up on any use of the mouse or keyboard, in any of the windows
    const listen = (win: Window, isMainWindow: boolean) => {
      const startedAt = performance.now();
      let origin: { x: number; y: number } | undefined;
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
      // Switching to another application has to end it as well: its windows are on top of everything
      const handleBlur = () => {
        if (performance.now() - startedAt > WAKE_GRACE_PERIOD) {
          wake();
        }
      };
      // Capturing, so that the key or click that wakes it up does not also do something in the gallery
      win.addEventListener('mousemove', handleMove, true);
      win.addEventListener('mousedown', wake, true);
      win.addEventListener('wheel', wake, true);
      win.addEventListener('keydown', handleKey, true);
      if (isMainWindow) {
        win.addEventListener('blur', handleBlur);
      }
      stopListening.push(() => {
        win.removeEventListener('mousemove', handleMove, true);
        win.removeEventListener('mousedown', wake, true);
        win.removeEventListener('wheel', wake, true);
        win.removeEventListener('keydown', handleKey, true);
        win.removeEventListener('blur', handleBlur);
      });
    };

    const run = async () => {
      // Whatever is being shown in the gallery at that moment: the images come from the database
      const images = withoutDuplicates(await fileStore.fetchScreensaverImages());
      if (!isRunning) {
        return;
      }
      if (images.length === 0) {
        // Nothing to show: black screens would look like something is broken
        AppToaster.show({
          message: 'The screensaver has no images to show: its tags have none.',
          timeout: 6000,
        });
        wake();
        return;
      }
      const {
        isScreensaverOnAllMonitors,
        isScreensaverSingleImage,
        method,
        screensaverSecondsPerImage,
      } = runInAction(() => ({
        isScreensaverOnAllMonitors: uiStore.isScreensaverOnAllMonitors,
        isScreensaverSingleImage: uiStore.isScreensaverSingleImage,
        method: uiStore.method,
        screensaverSecondsPerImage: uiStore.screensaverSecondsPerImage,
      }));
      const opened = await openScreens(isScreensaverOnAllMonitors);
      if (!isRunning) {
        closeScreens(opened);
        return;
      }
      surfaces = opened;
      if (surfaces.length === 0) {
        wake();
        return;
      }
      listen(window, true);
      surfaces.forEach((surface) => listen(surface.win, false));

      // The keyboard may belong to another application: Atlas does not have to be the window in front
      // for the screensaver to start, and its own windows never take the focus. So the system is asked
      // whether anything was used. With a timer of a screensaver window: those of the covered main
      // window run once a second at best
      const startedAt = performance.now();
      const timerWindow = surfaces[0].win;
      const inputCheck = timerWindow.setInterval(async () => {
        const { systemIdleSeconds } = await RendererMessenger.getIdleState();
        if (
          performance.now() - startedAt > WAKE_GRACE_PERIOD &&
          systemIdleSeconds < SCREENSAVER_WAKE_IDLE_SECONDS
        ) {
          wake();
        }
      }, 500);
      stopListening.push(() => timerWindow.clearInterval(inputCheck));

      // Like the layout of the gallery: columns for the vertical masonry view, rows for the others
      const orientation: LaneOrientation =
        method === ViewMethod.MasonryVertical ? 'columns' : 'rows';
      director = new ScreensaverDirector(surfaces, images, {
        orientation,
        secondsPerStep: screensaverSecondsPerImage,
        singleImage: isScreensaverSingleImage,
      });
      // For looking at it from the developer tools and from tests
      (window as any).__atlasScreensaver = { director, surfaces };
      await director.start();
    };
    run().catch((e) => {
      console.error('Could not run the screensaver', e);
      wake();
    });

    return () => {
      isRunning = false;
      stopListening.forEach((stop) => stop());
      director?.dispose();
      closeScreens(surfaces);
      delete (window as any).__atlasScreensaver;
    };
  }, [fileStore, uiStore, isScreensaverActive]);

  return null;
});

export default Screensaver;

import { SCREENSAVER_WINDOW_PREFIX } from 'common/screensaver';
import { RendererMessenger } from '../../ipc/renderer';
import { SCREENSAVER_STYLES, ScreenSurface, wait } from './tile';

/**
 * Opens a black window over every monitor (or only over the one Atlas is on), above everything else.
 * The main window is left exactly as it is underneath: nothing has to be put back afterwards.
 * @returns The screens from left to right. Closing their windows ends it
 */
export async function openScreens(useAllMonitors: boolean): Promise<ScreenSurface[]> {
  const displays = await RendererMessenger.getScreensaverDisplays();
  const chosen = displays
    .filter((display) => useAllMonitors || display.isCurrent)
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const windows: Window[] = [];
  for (const display of chosen) {
    const win = window.open('', `${SCREENSAVER_WINDOW_PREFIX}${display.id}`);
    if (win !== null) {
      windows.push(win);
    }
  }

  const surfaces: ScreenSurface[] = [];
  for (const win of windows) {
    const doc = win.document;
    doc.title = 'Atlas';
    const style = doc.createElement('style');
    style.textContent = SCREENSAVER_STYLES;
    doc.head.appendChild(style);
    const root = doc.createElement('div');
    root.className = 'screensaver-root';
    doc.body.appendChild(root);

    // A new window takes a moment to get its size
    let width = 0;
    let height = 0;
    for (let i = 0; i < 40; i++) {
      // On its own timer: the main window is being covered, and the browser slows down the timers of a
      // window that cannot be seen to once a second
      await wait(win, 50);
      if (win.closed) {
        break;
      }
      const isSettled =
        win.innerWidth > 0 && win.innerWidth === width && win.innerHeight === height;
      width = win.innerWidth;
      height = win.innerHeight;
      if (isSettled) {
        break;
      }
    }
    if (win.closed || width === 0 || height === 0) {
      win.close();
      continue;
    }
    surfaces.push({ win, root, width, height, devicePixelRatio: win.devicePixelRatio || 1 });
  }
  return surfaces;
}

export function closeScreens(surfaces: readonly ScreenSurface[]): void {
  for (const surface of surfaces) {
    try {
      surface.win.close();
    } catch (e) {
      console.error('Could not close a window of the screensaver', e);
    }
  }
}

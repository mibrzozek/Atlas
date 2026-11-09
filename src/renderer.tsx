// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Import the styles here to let Webpack know to include them
// in the HTML file
import './style.scss';

import Dexie from 'dexie';
import fse from 'fs-extra';
import { autorun, reaction, runInAction } from 'mobx';
import React from 'react';
import { Root, createRoot } from 'react-dom/client';

import { promiseRetry } from 'common/timeout';
import { IS_PREVIEW_WINDOW, WINDOW_STORAGE_KEY } from 'common/window';
import { RendererMessenger } from 'src/ipc/renderer';
import Backend from './backend/backend';
import App from './frontend/App';
import StoreProvider from './frontend/contexts/StoreContext';
import Overlay from './frontend/Overlay';
import PreviewApp from './frontend/Preview';
import { FILE_STORAGE_KEY } from './frontend/stores/FileStore';
import RootStore from './frontend/stores/RootStore';
import { PREFERENCES_STORAGE_KEY } from './frontend/stores/UiStore';
import BackupScheduler from './backend/backup-scheduler';
import { DB_NAME, dbInit } from './backend/config';

async function main(): Promise<void> {
  // Render our react components in the div with id 'app' in the html file
  const container = document.getElementById('app');

  if (container === null) {
    throw new Error('Unable to create user interface.');
  }

  const root = createRoot(container);

  const db = dbInit(DB_NAME);

  if (!IS_PREVIEW_WINDOW) {
    await runMainApp(db, root);
  } else {
    await runPreviewApp(db, root);
  }
}

async function runMainApp(db: Dexie, root: Root): Promise<void> {
  const defaultBackupDirectory = await RendererMessenger.getDefaultBackupDirectory();
  const backup = new BackupScheduler(db, defaultBackupDirectory);
  const [backend] = await Promise.all([
    Backend.init(db, () => backup.schedule()),
    fse.ensureDir(defaultBackupDirectory),
  ]);

  const rootStore = await RootStore.main(backend, backup);

  // The Director: development only, never in a build that is shipped (CLAUDE.md). The production build
  // leaves this branch, and the module, out entirely; scripts/check-production-bundle.js checks that
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./frontend/director').installDirector(rootStore);
  }

  // Recover global preferences
  try {
    const window_preferences = localStorage.getItem(WINDOW_STORAGE_KEY);
    if (window_preferences === null) {
      localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify({ isFullScreen: false }));
    } else {
      const prefs = JSON.parse(window_preferences);
      if (prefs.isFullScreen === true) {
        RendererMessenger.setFullScreen(true);
        rootStore.uiStore.setFullScreen(true);
      }
    }
  } catch (e) {
    console.error('Cannot load window preferences', e);
  }

  // Debounced and automatic storing of preferences
  reaction(
    () => rootStore.fileStore.getPersistentPreferences(),
    (preferences) => {
      localStorage.setItem(FILE_STORAGE_KEY, JSON.stringify(preferences));
    },
    { delay: 200 },
  );

  reaction(
    () => rootStore.uiStore.getPersistentPreferences(),
    (preferences) => {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    },
    { delay: 200 },
  );

  autorun(() => {
    document.title = rootStore.getWindowTitle();
  });

  root.render(
    <StoreProvider value={rootStore}>
      <App />
      <Overlay />
    </StoreProvider>,
  );

  // -------------------------------------------
  // Messaging with the main process
  // -------------------------------------------

  RendererMessenger.onImportExternalImage(async ({ item }) => {
    console.log('Importing image...', item);
    // Might take a while for the file watcher to detect the image - otherwise the image is not in the DB and cannot be tagged
    promiseRetry(() => addTagsToFile(item.filePath, item.tagNames));
  });

  RendererMessenger.onAddTagsToFile(async ({ item }) => {
    console.log('Adding tags to file...', item);
    await addTagsToFile(item.filePath, item.tagNames);
  });

  RendererMessenger.onGetTags(async () => ({ tags: await backend.fetchTags() }));

  RendererMessenger.onFullScreenChanged((val) => rootStore.uiStore.setFullScreen(val));

  /**
   * Adds tags to a file, given its name and the names of the tags
   * @param filePath The path of the file
   * @param tagNames The names of the tags
   */
  async function addTagsToFile(filePath: string, tagNames: string[]) {
    const { fileStore, tagStore } = rootStore;
    const clientFile = runInAction(() =>
      fileStore.fileList.find((file) => file.absolutePath === filePath),
    );
    if (clientFile) {
      const tags = await Promise.all(
        tagNames.map(async (tagName) => {
          const clientTag = tagStore.findByName(tagName);
          if (clientTag !== undefined) {
            return clientTag;
          } else {
            const newClientTag = await tagStore.create(tagStore.root, tagName);
            return newClientTag;
          }
        }),
      );
      tags.forEach(clientFile.addTag);
    } else {
      throw new Error('Could not find image to set tags for ' + filePath);
    }
  }

  RendererMessenger.onClosedPreviewWindow(() => {
    rootStore.uiStore.closePreviewWindow();
  });

  // Runs operations to run before closing the app, e.g. closing child-processes
  // TODO: for async operations, look into https://github.com/electron/electron/issues/9433#issuecomment-960635576
  window.addEventListener('beforeunload', () => {
    rootStore.close();
  });

  // The window is shown from here on (see `revealMainWindow` in main.ts), and the gallery comes into view.
  // Its animation begins once the window is on screen and has painted, not while it is still appearing,
  // which cut off the start of the logo's fade
  await galleryDrawn();
  const revealed = RendererMessenger.onceRevealed();
  RendererMessenger.initialized();
  await Promise.race([revealed, new Promise((resolve) => setTimeout(resolve, REVEALED_LIMIT))]);
  await framesPainted();
  rootStore.uiStore.playStartup();
}

/** How long the page waits for the main process to say the window is on screen */
const REVEALED_LIMIT = 1000;

/** Two frames later: what the page has drawn is on screen. At most 200 ms, should frames not come */
function framesPainted(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 200);
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve)));
  });
}

/** How long the start waits for the gallery's images before the window is shown without them */
const GALLERY_DRAWN_LIMIT = 4000;

/**
 * Resolves once the gallery has drawn the images in view, or shows that there are none: the window opens
 * with nothing left to pop in. Thumbnails still to be made hold it up for `GALLERY_DRAWN_LIMIT` at most.
 */
async function galleryDrawn(): Promise<void> {
  const until = performance.now() + GALLERY_DRAWN_LIMIT;
  while (performance.now() < until) {
    if (document.getElementById('content-placeholder') !== null) {
      return;
    }
    const gallery = document.getElementById('gallery-content');
    const images = Array.from(gallery?.querySelectorAll('img') ?? []);
    // An image that could not be loaded keeps its spinner (`data-failed`): not waited for
    if (images.length > 0 && gallery?.querySelector('.image-loading:not([data-failed])') === null) {
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
      return framesPainted();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function runPreviewApp(db: Dexie, root: Root): Promise<void> {
  const backend = new Backend(db, () => {});
  const rootStore = await RootStore.preview(backend, new BackupScheduler(db, ''));

  RendererMessenger.initialized();

  await new Promise<void>((executor) => {
    let initRender: (() => void) | undefined = executor;

    RendererMessenger.onReceivePreviewFiles(
      async ({ ids, thumbnailDirectory, viewMethod, activeImgId }) => {
        rootStore.uiStore.setThumbnailDirectory(thumbnailDirectory);
        rootStore.uiStore.setMethod(viewMethod);
        rootStore.uiStore.enableSlideMode();

        runInAction(() => {
          rootStore.uiStore.isInspectorOpen = false;
        });

        const files = await backend.fetchFilesByID(ids);

        // If a file has a location we don't know about (e.g. when a new location was added to the main window),
        // re-fetch the locations in the preview window
        const hasNewLocation = runInAction(() =>
          files.some((f) => !rootStore.locationStore.locationList.find((l) => l.id === f.id)),
        );
        if (hasNewLocation) {
          await rootStore.locationStore.init();
        }

        await rootStore.fileStore.updateFromBackend(files);
        rootStore.uiStore.setFirstItem((activeImgId && ids.indexOf(activeImgId)) || 0);

        if (initRender !== undefined) {
          initRender();
          initRender = undefined;
        }
      },
    );
  });

  autorun(() => {
    document.title = rootStore.getWindowTitle();
  });

  // Render our react components in the div with id 'app' in the html file
  // The Provider component provides the state management for the application
  root.render(
    <StoreProvider value={rootStore}>
      <PreviewApp />
      <Overlay />
    </StoreProvider>,
  );

  // Close preview with space
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Escape') {
      rootStore.uiStore.clearFileSelection();
      rootStore.fileStore.clearFileList();
      rootStore.uiStore.enableSlideMode();

      // remove focus from element so closing preview with spacebar does not trigger any ui elements
      if (document.activeElement && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      window.close();
    }
  });
}

main()
  .then(() => console.info('Successfully initialized Atlas!'))
  .catch((err) => {
    console.error('Could not initialize Atlas!', err);
    window.alert('An error has occurred, check the console for more details');

    RendererMessenger.toggleDevTools();
  });

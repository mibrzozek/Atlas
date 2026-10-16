import React, { useCallback, useEffect } from 'react';
import { reaction, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';

import { useStore } from './contexts/StoreContext';

import ErrorBoundary from './containers/ErrorBoundary';
import HelpCenter from './containers/HelpCenter';

import AdvancedSearchDialog from './containers/AdvancedSearch';
import Settings from './containers/Settings';
import StatusFooter from './containers/StatusFooter';

import { ThumbnailTarget, useWorkerListener } from './image/ThumbnailGeneration';
import WindowTitlebar from './containers/WindowTitlebar';
import { DropContextProvider } from './contexts/DropContext';
import Main from './containers/Main';
import TopBar from './containers/TopBar';
import FolderCreator from './containers/FolderCreator';
import TagManager from './containers/TagManager';
import Screensaver from './containers/Screensaver';
import About from './containers/About';
import { CustomThemeProvider } from './hooks/useCustomTheme';
import { useClipboardImporter } from './hooks/useClipboardImporter';

const PLATFORM = process.platform;

const App = observer(() => {
  const { uiStore, fileStore, imageLoader } = useStore();

  // Listen to responses of Web Workers
  useWorkerListener();

  // Generate thumbnails of the shown images in the background, so browsing doesn't have to wait for them
  useEffect(() => {
    let cancel = () => {};
    // Fetching the whole library is too heavy to do every time another set of images is shown
    let library: { numFiles: number; targets: ThumbnailTarget[] } | undefined;
    let numFilesWhenLibraryWasDone = -1;
    const dispose = reaction(
      () => fileStore.fileList.slice(),
      (files) => {
        cancel();
        let isCancelled = false;
        cancel = () => (isCancelled = true);
        // First the images that are shown, then the rest of the library
        imageLoader
          .pregenerateThumbnails(files, () => isCancelled)
          .then(async () => {
            const numFiles = runInAction(() => fileStore.numTotalFiles);
            if (isCancelled || numFiles === numFilesWhenLibraryWasDone) {
              return;
            }
            if (library?.numFiles !== numFiles) {
              library = { numFiles, targets: await fileStore.fetchThumbnailTargets() };
            }
            await imageLoader.pregenerateThumbnails(library.targets, () => isCancelled);
            if (!isCancelled) {
              numFilesWhenLibraryWasDone = numFiles;
              library = undefined;
            }
          })
          .catch(console.error);
      },
      { fireImmediately: true, delay: 2000 },
    );
    return () => {
      dispose();
      cancel();
    };
  }, [fileStore, imageLoader]);
  useClipboardImporter(uiStore);

  const isOutlinerOpen = uiStore.isOutlinerOpen;

  useEffect(() => {
    // Add listener for global keyboard shortcuts
    window.addEventListener('keydown', uiStore.processGlobalShortCuts);

    return () => window.removeEventListener('keydown', uiStore.processGlobalShortCuts);
  }, [uiStore.processGlobalShortCuts]);

  // Automatically expand outliner when detecting a drag event
  const openOutlinerOnDragEnter = useCallback(() => {
    if (!isOutlinerOpen) {
      uiStore.toggleOutliner();
    }
  }, [uiStore, isOutlinerOpen]);

  return (
    <CustomThemeProvider>
      <DropContextProvider onDragEnter={openOutlinerOnDragEnter}>
        <div
          data-os={PLATFORM}
          data-fullscreen={uiStore.isFullScreen}
          id="layout-container"
          className={uiStore.theme}
        >
          {!uiStore.isFullScreen && <WindowTitlebar />}

          <ErrorBoundary>
            <TopBar />

            <Main />

            <FolderCreator />

            <TagManager />

            <Settings />

            <HelpCenter />

            <About />

            <AdvancedSearchDialog />

            <StatusFooter />

            <Screensaver />
          </ErrorBoundary>
        </div>
      </DropContextProvider>
    </CustomThemeProvider>
  );
});

export default App;

import { shell } from 'electron';
import { autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import SysPath from 'path';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { encodeFilePath } from 'common/fs';
import { Button, IconSet, Split } from 'widgets';
import { useStore } from '../../../contexts/StoreContext';
import { ClientFile } from '../../../entities/File';
import { useAction, useComputed } from '../../../hooks/mobx';
import { usePromise } from '../../../hooks/usePromise';
import { UpscaleMode } from '../../../stores/UiStore';
import Inspector from '../../Inspector';
import { CommandDispatcher } from '../Commands';
import ZoomPan, { CONTAINER_DEFAULT_STYLE, SlideTransform } from '../SlideMode/ZoomPan';
import { ContentRect } from '../utils';
import { Vec2, createDimension, createTransform } from './utils';

const SlideMode = observer(({ contentRect }: { contentRect: ContentRect }) => {
  const { uiStore } = useStore();
  const isInspectorOpen = uiStore.isInspectorOpen;
  const inspectorWidth = uiStore.inspectorWidth;
  const contentWidth = contentRect.width - (isInspectorOpen ? inspectorWidth : 0);
  const contentHeight = contentRect.height;

  return (
    <Split
      id="slide-mode"
      className={uiStore.isSlideMode ? 'fade-in' : 'fade-out'}
      primary={<Inspector />}
      secondary={<SlideView width={contentWidth} height={contentHeight} />}
      axis="vertical"
      align="right"
      splitPoint={inspectorWidth}
      isExpanded={isInspectorOpen}
      onMove={uiStore.moveInspectorSplitter}
    />
  );
});

interface SlideViewProps {
  width: number;
  height: number;
}

const SlideView = observer(({ width, height }: SlideViewProps) => {
  const { uiStore, fileStore, imageLoader } = useStore();
  const file = uiStore.firstFileInView;
  const eventManager = useMemo(() => (file ? new CommandDispatcher(file) : undefined), [file]);
  const isFirst = useComputed(() => uiStore.firstItem === 0);
  const isLast = useComputed(() => uiStore.firstItem === fileStore.fileList.length - 1);

  // Go to the first selected image on load
  useEffect(() => {
    return reaction(
      () => uiStore.firstSelectedFile?.id,
      (id, _, reaction) => {
        if (id !== undefined) {
          const index = fileStore.getIndex(id);
          uiStore.setFirstItem(index);

          // Also, select only this file: makes more sense for the TagEditor overlay: shows tags on selected images
          if (index !== undefined) {
            uiStore.selectFile(fileStore.fileList[index], true);
          }

          reaction.dispose();
        }
      },
      { fireImmediately: true },
    );
  }, [fileStore, uiStore]);

  // Go back to previous view when pressing the back button (mouse button 5)
  useEffect(() => {
    // Push a dummy state, so that a pop-state event can be activated
    // TODO: would be nice to also open SlideMode again when pressing forward button: actually store the open image in the window.location?
    history.pushState(null, document.title, location.href);
    const popStateHandler = uiStore.disableSlideMode;
    window.addEventListener('popstate', popStateHandler);
    return () => window.removeEventListener('popstate', popStateHandler);
  }, [uiStore]);

  const decrImgIndex = useAction(() => {
    const index = Math.max(0, uiStore.firstItem - 1);
    uiStore.setFirstItem(index);

    // Select only this file: TagEditor overlay shows tags on selected images
    uiStore.selectFile(fileStore.fileList[index], true);
  });
  const incrImgIndex = useAction(() => {
    const index = Math.min(uiStore.firstItem + 1, fileStore.fileList.length - 1);
    uiStore.setFirstItem();
    uiStore.selectFile(fileStore.fileList[index], true);
  });

  // Detect left/right arrow keys to scroll between images. Top/down is already handled in the layout that's open in the background
  useEffect(() => {
    const handleUserKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        decrImgIndex();
        event.stopPropagation();
      } else if (event.key === 'ArrowRight') {
        incrImgIndex();
        event.stopPropagation();
      } else if (event.key === 'Escape' || event.key === 'Backspace') {
        if (event.target instanceof HTMLInputElement) {
          return;
        }
        uiStore.disableSlideMode();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleUserKeyPress);
    return () => {
      window.removeEventListener('keydown', handleUserKeyPress);
    };
  }, [decrImgIndex, incrImgIndex, uiStore]);

  // Preload next and previous image for better UX
  useEffect(
    () =>
      autorun(() => {
        if (!isLast.get() && uiStore.firstItem + 1 < fileStore.fileList.length) {
          imageLoader.preloadImage(fileStore.fileList[uiStore.firstItem + 1], true);
        }
        if (!isFirst.get() && fileStore.fileList.length > 0) {
          imageLoader.preloadImage(fileStore.fileList[uiStore.firstItem - 1], true);
        }
      }),
    [fileStore, isFirst, isLast, uiStore, imageLoader],
  );

  const transitionStart: SlideTransform | undefined = useMemo(() => {
    if (!file) {
      return undefined;
    }
    const thumbEl = document.querySelector(`[data-file-id="${file.id}"]`);
    const container = document.querySelector('#gallery-content');
    if (thumbEl && container) {
      const thumbElRect = thumbEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return createTransform(
        thumbElRect.top - containerRect.top,
        thumbElRect.left - containerRect.left,
        thumbElRect.height / file.height,
      );
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  return (
    <div
      id="zoomable-image"
      style={{ width, height }}
      onContextMenu={eventManager?.showSlideContextMenu}
      onDrop={eventManager?.drop}
      tabIndex={-1}
    >
      {file && (
        <ZoomableImage
          file={file}
          thumbnailSrc={file.thumbnailPath}
          width={width}
          height={height}
          transitionStart={transitionStart}
          transitionEnd={uiStore.isSlideMode ? undefined : transitionStart}
          onClose={uiStore.disableSlideMode}
          upscaleMode={uiStore.upscaleMode}
        />
      )}
      <NavigationButtons
        isStart={isFirst.get()}
        isEnd={isLast.get()}
        prevImage={decrImgIndex}
        nextImage={incrImgIndex}
      />
    </div>
  );
});

interface ZoomableImageProps {
  file: ClientFile;
  thumbnailSrc: string;
  width: number;
  height: number;
  transitionStart?: SlideTransform;
  transitionEnd?: SlideTransform;
  onClose: () => void;
  upscaleMode: UpscaleMode;
}

const ZoomableImage: React.FC<ZoomableImageProps> = ({
  file,
  thumbnailSrc,
  width,
  height,
  transitionStart,
  transitionEnd,
  onClose,
  upscaleMode,
}: ZoomableImageProps) => {
  const { imageLoader } = useStore();
  const { id: fileId, absolutePath, width: imgWidth, height: imgHeight } = file;
  // Image src can be set asynchronously: keep track of it in a state
  // Needed for image formats not natively supported by the browser (e.g. tiff): will be converted to another format
  const source = usePromise(file, thumbnailSrc, async (file, thumbnailPath) => {
    const src = await imageLoader.getImageSrc(file);
    return { fileId: file.id, src: src ?? thumbnailPath };
  });

  // Decoding a large image makes the opening transition freeze for a moment.
  // So the transition is done with just the thumbnail: the full image is put on top of it afterwards.
  const [isOpened, setIsOpened] = useState(transitionStart === undefined);
  const handleOpened = useCallback(() => setIsOpened(true), []);
  // The decoding itself can already be done during the transition, as long as the image is not on screen yet.
  // Once it has been decoded, it can be shown right away without freezing the transition.
  const [predecodedFileId, setPredecodedFileId] = useState<string>();
  useEffect(() => {
    let isEffectRunning = true;
    imageLoader
      .preloadImage(file)
      .then((isDecoded) => isEffectRunning && isDecoded && setPredecodedFileId(file.id));
    return () => {
      isEffectRunning = false;
    };
  }, [imageLoader, file]);
  const [loaded, setLoaded] = useState<{ src: string; dimension: Vec2; isDecoded: boolean }>();
  const [failedSrc, setFailedSrc] = useState<string>();

  const previewSrc = thumbnailSrc || absolutePath;
  const isSourceReady = source.tag === 'ready' && 'ok' in source.value;
  // The source can still belong to the previously shown file for a moment
  const fullSrc =
    source.tag === 'ready' && 'ok' in source.value && source.value.ok.fileId === fileId
      ? source.value.ok.src
      : undefined;
  const sourceError =
    source.tag === 'ready' && 'err' in source.value ? source.value.err : undefined;
  const hasFullLayer = fullSrc !== undefined && fullSrc !== previewSrc;

  if (sourceError !== undefined || (isSourceReady && failedSrc === (fullSrc ?? previewSrc))) {
    return <ImageFallback error={sourceError} absolutePath={absolutePath} />;
  }

  const dimension =
    loaded !== undefined && loaded.src === fullSrc
      ? loaded.dimension
      : createDimension(imgWidth, imgHeight);
  const isFullImageShown = loaded !== undefined && loaded.src === fullSrc && loaded.isDecoded;
  const minScale = Math.min(0.1, Math.min(width / dimension[0], height / dimension[1]));

  const handleFullImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const src = fullSrc;
    if (src === undefined) {
      return;
    }
    const dimension = createDimension(img.naturalWidth, img.naturalHeight);
    setLoaded({ src, dimension, isDecoded: false });
    // The thumbnail can only be hidden when the full image is ready to be painted: otherwise nothing is shown for a moment
    img
      .decode()
      .then(() => setLoaded((l) => (l?.src === src ? { ...l, isDecoded: true } : l)))
      .catch(() => undefined);
  };

  return (
    <ZoomPan
      position="center"
      initialScale="auto"
      doubleTapBehavior="zoomOrReset"
      imageDimension={dimension}
      containerDimension={createDimension(width, height)}
      minScale={minScale}
      maxScale={5}
      transitionStart={transitionStart}
      transitionEnd={transitionEnd}
      onClose={onClose}
      onOpened={handleOpened}
      upscaleMode={upscaleMode}
    >
      {(layerProps) => (
        <div
          {...layerProps}
          className="zoomable-image-layers"
          style={{ ...layerProps.style, width: dimension[0], height: dimension[1] }}
        >
          <img
            key={previewSrc}
            src={encodeFilePath(previewSrc)}
            alt=""
            // Not kept underneath the full image: it would be visible through transparent images
            style={isFullImageShown ? { visibility: 'hidden' } : undefined}
            onError={(e) =>
              hasFullLayer || !isSourceReady
                ? (e.currentTarget.style.visibility = 'hidden')
                : setFailedSrc(previewSrc)
            }
          />
          {(isOpened || predecodedFileId === fileId) && hasFullLayer && (
            <img
              key={fullSrc}
              src={encodeFilePath(fullSrc)}
              alt=""
              decoding="async"
              onLoad={handleFullImageLoad}
              onError={() => setFailedSrc(fullSrc)}
            />
          )}
        </div>
      )}
    </ZoomPan>
  );
};

export default SlideMode;

interface NavigationButtonsProps {
  isStart: boolean;
  isEnd: boolean;
  prevImage: () => void;
  nextImage: () => void;
}

const NavigationButtons = ({ isStart, isEnd, prevImage, nextImage }: NavigationButtonsProps) => {
  const none = { display: 'none' };
  const initial = { display: 'initial' };
  return (
    <>
      <button
        style={isStart ? none : initial}
        aria-label="previous image"
        className="side-button-left"
        onClick={prevImage}
      >
        {IconSet.ARROW_LEFT}
      </button>
      <button
        style={isEnd ? none : initial}
        aria-label="next image"
        className="side-button-right"
        onClick={nextImage}
      >
        {IconSet.ARROW_RIGHT}
      </button>
    </>
  );
};

interface ImageFallbackProps {
  error: any;
  absolutePath: string;
}

const ImageFallback = ({ error, absolutePath }: ImageFallbackProps) => {
  return (
    <div style={CONTAINER_DEFAULT_STYLE} className="image-fallback">
      <div style={{ maxHeight: 360, maxWidth: 360 }} className="image-error" />
      <br />
      <span>Could not load {error ? '' : 'full '}image </span>
      <pre
        title={absolutePath}
        style={{ maxWidth: '40ch', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {SysPath.basename(absolutePath)}
      </pre>
      <Button
        onClick={() =>
          shell
            .openExternal(encodeFilePath(absolutePath))
            .catch((e) => console.error(e, absolutePath))
        }
        text="Open in external application"
      />
    </div>
  );
};

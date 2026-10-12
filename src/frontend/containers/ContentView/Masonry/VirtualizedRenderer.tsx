import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { thumbnailMaxSize } from 'common/config';
import { debouncedThrottle } from 'common/timeout';
import { useStore } from '../../../contexts/StoreContext';
import { ClientFile } from '../../../entities/File';
import { COLLAGE_ANIMATION_DURATION } from '../../../stores/FileStore';
import useMountState from '../../../hooks/useMountState';
import { MasonryCell } from '../GalleryItem';
import { Layouter, findViewportEdge } from './layout-helpers';

interface IRendererProps {
  containerHeight: number;
  containerWidth: number;
  images: ClientFile[];
  layout: Layouter;
  className?: string;
  /** Render images outside of the viewport within this margin (pixels) */
  overscan?: number;
  layoutUpdateDate: Date;
  padding?: number;
  /** The index of the currently selected image, or the "last selected" image when a range is selected */
  lastSelectionIndex: React.MutableRefObject<number | undefined>;
}

/**
 * This is the virtualized renderer: it only renders the items in the viewport.
 * It renders a scrollable viewport and a content element within it.
 */
const VirtualizedRenderer = observer(
  ({
    containerHeight,
    containerWidth,
    images,
    layout,
    className,
    overscan = 0,
    lastSelectionIndex,
    layoutUpdateDate,
    padding,
  }: IRendererProps) => {
    const { uiStore, fileStore } = useStore();
    const [, isMountedRef] = useMountState();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const scrollAnchor = useRef<HTMLDivElement>(null);
    const [startRenderIndex, setStartRenderIndex] = useState(0);
    const [endRenderIndex, setEndRenderIndex] = useState(0);
    const numImages = images.length;
    const { isSlideMode, firstItem } = uiStore;

    const determineRenderRegion = useCallback(
      (numImages: number, overdraw: number, setFirstItem = true) => {
        if (!isMountedRef.current) {
          return;
        }
        const viewport = wrapperRef.current;
        const yOffset = viewport?.scrollTop || 0;
        const viewportHeight = viewport?.clientHeight || 0;

        const firstImageIndex = findViewportEdge(yOffset, numImages, layout);
        const start = findViewportEdge(yOffset - overdraw, numImages, layout);
        const end = findViewportEdge(yOffset + viewportHeight + overdraw, numImages, layout);

        setStartRenderIndex(start);
        // hard limit of 512 images at once, for safety reasons (we don't want any exploding computers). Might be bad for people with 4k screens and small thumbnails...
        setEndRenderIndex(Math.min(end, start + 512));

        // store the first item in the viewport in the UIStore so that switching between view modes retains the scroll position
        if (setFirstItem) {
          uiStore.setFirstItem(firstImageIndex);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const throttledRedetermine = useRef(
      debouncedThrottle(
        (numImages: number, overdraw: number, setFirstItem?: boolean) =>
          determineRenderRegion(numImages, overdraw, setFirstItem),
        100,
      ),
    );

    // Redetermine images in viewport when amount of images or the container dimensions change
    useLayoutEffect(() => {
      // setFirstItem = false: don't set the firstItem in view, so we can recover scroll position after layout updates,
      // in the useLayoutEffect with layoutUpdateDate dependency
      throttledRedetermine.current(numImages, overscan, false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numImages, containerWidth, containerHeight]);

    const handleScroll = useCallback(
      () =>
        throttledRedetermine.current(
          numImages,
          overscan || 0,
          // dont't scroll set first item while in slide mode due to scrolling, since it's controlled over there
          !isSlideMode,
        ),
      [numImages, overscan, isSlideMode],
    );

    const scrollToIndex = useCallback(
      (index: number, block: 'nearest' | 'start' | 'end' | 'center' = 'nearest') => {
        if (!scrollAnchor.current) {
          return;
        }
        const [sWidth, sHeight, sTop, sLeft] = layout.getTransform(index);

        // Scroll to invisible element, positioned at selected item,
        // just for scroll automatisation with scrollIntoView
        scrollAnchor.current.style.transform = `translate(${sLeft}px,${
          // Correct for padding of masonry element, otherwise it doesn't completely scroll to the top.
          sTop === 0 && padding ? sTop - padding : sTop
        }px)`;
        scrollAnchor.current.style.width = sWidth + 'px';
        scrollAnchor.current.style.height = sHeight + 'px';
        // TODO: adding behavior: 'smooth' would be nice, but it's disorienting when layout changes a lot. Add threshold for when the delta firstItemIndex than X?
        // Also, it doesn't work when scrolling by keeping arrow key held down
        scrollAnchor.current.scrollIntoView({ block, inline: 'nearest' });
        scrollAnchor.current.style.transform = ''; // reset so that the scroll position can't become stuck at bottom when amount of shown images decreases
      },
      [layout, padding],
    );

    // The index currently selected image, or the "last selected" image when a range is selected,
    const lastSelIndex = lastSelectionIndex.current
      ? Math.min(lastSelectionIndex.current, numImages - 1)
      : undefined;

    // When layout updates, scroll to firstImage (e.g. resize or thumbnail size changed)
    // This also sets the initial scroll position on initial render, for when coming from another view mode
    useLayoutEffect(() => {
      // Not after moving images by hand in collage mode: everything else stays exactly where it is
      if (performance.now() - fileStore.lastCollageReorder < 1500) {
        return;
      }
      runInAction(() => {
        scrollToIndex(uiStore.firstItem, 'start'); // keep the first item in view aligned at the start
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layoutUpdateDate]);

    // When collage mode is switched on or off, the images that were on screen stay around for a moment:
    // the ones that end up outside of the view glide out of it, instead of vanishing on the spot
    const visibleFiles = images.slice(startRenderIndex, endRenderIndex + 1);
    const lastVisibleFiles = useRef<ClientFile[]>([]);
    const [lingeringFiles, setLingeringFiles] = useState<ClientFile[]>([]);
    const lingerTimeout = useRef<number>();
    useLayoutEffect(() => {
      if (performance.now() - fileStore.lastCollageToggle > COLLAGE_ANIMATION_DURATION * 2) {
        return;
      }
      // The layout is updated more than once after a switch: what was on screen before the first update
      // is kept through all of them
      setLingeringFiles((lingering) =>
        Array.from(new Set([...lingering, ...lastVisibleFiles.current])),
      );
      window.clearTimeout(lingerTimeout.current);
      lingerTimeout.current = window.setTimeout(
        () => setLingeringFiles([]),
        COLLAGE_ANIMATION_DURATION,
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layoutUpdateDate]);
    useEffect(() => () => window.clearTimeout(lingerTimeout.current), []);
    useEffect(() => {
      lastVisibleFiles.current = visibleFiles;
    });

    // What is drawn, with the place of each in the list. In a fixed order (by id), not the order of the list:
    // an element that React moves within the page loses its animation, and jumps instead of gliding
    const cells: { file: ClientFile; index: number }[] = visibleFiles.map((file, i) => ({
      file,
      index: startRenderIndex + i,
    }));
    if (lingeringFiles.length > 0) {
      const visibleIds = new Set(visibleFiles.map((file) => file.id));
      for (const file of lingeringFiles) {
        const index = fileStore.getIndex(file.id);
        if (index !== undefined && !visibleIds.has(file.id) && images[index] === file) {
          cells.push({ file, index });
        }
      }
    }
    cells.sort((a, b) => (a.file.id < b.file.id ? -1 : 1));

    // When selection changes, scroll to last selected image. Nice when using cursor keys for navigation
    const fileSelectionSize = uiStore.fileSelection.size;
    useLayoutEffect(() => {
      // But don't scroll when there are no files selected:
      // else you will scroll when the user deselects everything
      if (lastSelIndex !== undefined && fileSelectionSize > 0) {
        scrollToIndex(lastSelIndex);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSelIndex, fileSelectionSize]);

    // While in slide mode, scroll to last shown image if not in view, for transition back to gallery
    useLayoutEffect(() => {
      if (isSlideMode) {
        scrollToIndex(firstItem, 'nearest');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSlideMode, firstItem]);

    return (
      // One div as the scrollable viewport
      <div className={className} onScroll={handleScroll} ref={wrapperRef}>
        {/* One div for the content */}
        <div style={{ width: containerWidth, height: containerHeight }}>
          {cells.map(({ file: im, index: fileListIndex }) => {
            const transform = layout.getTransform(fileListIndex);
            return (
              <MasonryCell
                key={im.id}
                file={im}
                mounted
                transform={transform}
                // Force to load the full resolution image when the img dimensions on screen are larger than the thumbnail image resolution
                // Otherwise you'll see very low res images.
                // Only for formats that cannot be drawn at the right size in the background (see SharpImages):
                // for the others the cell asks for exactly the pixels it needs
                forceNoThumbnail={
                  transform[0] > thumbnailMaxSize ||
                  transform[1] > thumbnailMaxSize ||
                  // Not using thumbnails for gifs, since they're mostly used for animations, which doesn't get preserved in thumbnails
                  im.extension === 'gif'
                }
              />
            );
          })}
          <div ref={scrollAnchor} id="invis-last-selected-item-for-scroll" />
        </div>
      </div>
    );
  },
);

export default VirtualizedRenderer;

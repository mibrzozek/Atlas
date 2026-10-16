import { runInAction } from 'mobx';
import React from 'react';

import { COLLAGE_DND_TYPE } from 'common/collage';
import { ClientFile } from '../../entities/File';
import { CommandDispatcher } from './Commands';
import FileStore from '../../stores/FileStore';
import UiStore from '../../stores/UiStore';

/** The image that is being dragged to another place of the collage */
let dragged: ClientFile | undefined;

type DragEvent = React.DragEvent<HTMLElement>;

/** The space between two images of the gallery, in pixels */
const GAP = 8;
const MARKER_WIDTH = 4;

/** A glowing line in the gap between two images: where the dragged image lands */
let marker: HTMLDivElement | undefined;

/**
 * The marker is an element of its own in the gallery, next to the image that is pointed at:
 * the images clip everything that is drawn outside of them.
 */
function showMarker(thumbnail: HTMLElement, place: 'before' | 'after') {
  const cell = thumbnail.parentElement;
  const gallery = cell?.parentElement;
  if (!cell || !gallery) {
    return;
  }
  if (marker === undefined) {
    marker = document.createElement('div');
    marker.className = 'collage-drop-marker';
  }
  if (marker.parentElement !== gallery) {
    gallery.appendChild(marker);
  }
  // Where "0, 0" is for the marker is measured, not assumed: the gallery has padding, and scrolls
  marker.style.left = '0';
  marker.style.top = '0';
  const origin = marker.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const edge = place === 'before' ? cellRect.left - GAP / 2 : cellRect.right + GAP / 2;
  marker.style.left = `${edge - MARKER_WIDTH / 2 - origin.left}px`;
  marker.style.top = `${cellRect.top - origin.top}px`;
  marker.style.width = `${MARKER_WIDTH}px`;
  marker.style.height = `${cellRect.height}px`;
}

/** After a drop the images are drawn again in other places: no element may stay dimmed */
function clearDragging() {
  document
    .querySelectorAll<HTMLElement>('[data-collage-dragging]')
    .forEach((element) => delete element.dataset.collageDragging);
}

function hideMarker() {
  marker?.remove();
}

/** How close to the top or bottom edge of the gallery the pointer has to be for it to scroll, in pixels */
const SCROLL_EDGE = 90;
/** The most it scrolls in one frame, right at the edge */
const SCROLL_SPEED = 28;

/** Stops the scrolling that goes with a drag */
let stopAutoScroll = () => {};

/**
 * While an image is dragged, the wheel does nothing: the browser sends no scroll events during a drag.
 * So the gallery scrolls by itself while the image is held near its top or bottom edge,
 * faster the closer it is.
 */
function startAutoScroll(thumbnail: HTMLElement) {
  stopAutoScroll();
  const scroller = thumbnail.closest<HTMLElement>('.masonry');
  if (scroller === null) {
    return;
  }
  let pointerY: number | undefined;
  let frame = 0;
  const track = (event: globalThis.DragEvent) => (pointerY = event.clientY);
  const step = () => {
    if (pointerY !== undefined) {
      const { top, bottom } = scroller.getBoundingClientRect();
      const intoTop = top + SCROLL_EDGE - pointerY;
      const intoBottom = pointerY - (bottom - SCROLL_EDGE);
      if (intoTop > 0) {
        scroller.scrollTop -= Math.ceil(SCROLL_SPEED * Math.min(1, intoTop / SCROLL_EDGE));
      } else if (intoBottom > 0) {
        scroller.scrollTop += Math.ceil(SCROLL_SPEED * Math.min(1, intoBottom / SCROLL_EDGE));
      }
    }
    frame = requestAnimationFrame(step);
  };
  document.addEventListener('dragover', track, true);
  frame = requestAnimationFrame(step);
  stopAutoScroll = () => {
    document.removeEventListener('dragover', track, true);
    cancelAnimationFrame(frame);
    stopAutoScroll = () => {};
  };
}

/** Left half of an image: the dragged one goes before it. Right half: after it */
const placeOf = (event: DragEvent): 'before' | 'after' => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
};

/**
 * Drag and drop for collage mode: an image of the gallery is dragged onto another one, and lands
 * before or after it. Dragging one of several selected images moves all of them.
 */
export function createCollageDnD(
  file: ClientFile,
  fileStore: FileStore,
  uiStore: UiStore,
  /** Handles what is not a collage drag: a tag that is dropped on the image */
  other: Pick<CommandDispatcher, 'dragOver' | 'dragLeave' | 'drop' | 'dragEnd'>,
) {
  return {
    dragStart(event: DragEvent) {
      event.stopPropagation();
      // Only the mark of a collage drag: without the picture itself as a file or a link,
      // nothing else in or outside the window takes it for something to import
      event.dataTransfer.clearData();
      event.dataTransfer.setData(COLLAGE_DND_TYPE, file.id);
      event.dataTransfer.effectAllowed = 'move';
      dragged = file;
      // Dimmed for as long as it is in the air
      event.currentTarget.dataset.collageDragging = 'true';
      startAutoScroll(event.currentTarget);
    },
    dragOver(event: DragEvent) {
      if (dragged === undefined) {
        return other.dragOver(event);
      }
      if (dragged === file) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const place = placeOf(event);
      event.currentTarget.dataset.collageDrop = place;
      showMarker(event.currentTarget, place);
    },
    dragLeave(event: DragEvent) {
      if (dragged === undefined) {
        return other.dragLeave(event);
      }
      delete event.currentTarget.dataset.collageDrop;
      hideMarker();
    },
    drop(event: DragEvent) {
      if (dragged === undefined) {
        return other.drop(event);
      }
      event.preventDefault();
      event.stopPropagation();
      delete event.currentTarget.dataset.collageDrop;
      hideMarker();
      clearDragging();
      stopAutoScroll();
      const source = dragged;
      dragged = undefined;
      if (source === undefined || source === file) {
        return;
      }
      const place = placeOf(event);
      runInAction(() => {
        const moved = uiStore.fileSelection.has(source)
          ? fileStore.fileList.filter((f) => uiStore.fileSelection.has(f))
          : [source];
        fileStore.moveFilesInCollage(moved, file, place);
      });
    },
    dragEnd(event: DragEvent) {
      clearDragging();
      hideMarker();
      stopAutoScroll();
      if (dragged === undefined) {
        return other.dragEnd(event);
      }
      dragged = undefined;
      delete event.currentTarget.dataset.collageDrop;
    },
  };
}

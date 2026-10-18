import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { encodeFilePath } from 'common/fs';
import { Crop, cropOf } from 'common/crop';
import { getSharpSize } from 'common/sharp-size';
import {
  Rect,
  TEXT_LINE_HEIGHT,
  WorkspaceImageItem,
  WorkspaceItem,
  WorkspaceTextItem,
} from 'common/workspace';
import { sharpImages } from '../../image/SharpImages';
import { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { TEXT_FONT_WEIGHT } from './measureText';

/** The size of the handle for sizing something, and of the ring around what is selected, on the screen */
const HANDLE_PIXELS = 14;
/** How long a size has to hold before the image is drawn sharp at it, in ms */
const SHARP_DELAY = 200;
const RING_PIXELS = 2;

interface FrameProps {
  item: WorkspaceItem;
  /** The zoom the camera came to rest at: how many screen pixels one unit of the workspace is */
  zoom: number;
  isSelected: boolean;
  /** Whether it has the handle for sizing it: when it is the only one selected */
  isSizable: boolean;
  /** Whether it is being cropped: then the crop shows it, and this one is not seen */
  isCropped?: boolean;
  /** The colour of a text (`textInk`): its own, or the one that reads on the paper under it */
  ink?: string;
}

/**
 * Something on the workspace, where it is: an image or a text in a frame that shows when it is selected
 * and has a handle for sizing it. While it is dragged or sized, `WorkspaceSurface` moves it in the page
 * directly.
 */
const WorkspaceObject = memo(function WorkspaceObject(
  props: FrameProps & { source: WorkspaceImageSource | undefined },
) {
  const { item, zoom, isSelected, isSizable, isCropped, source, ink } = props;
  const element = useRef<HTMLDivElement>(null);

  // Drawn at its new place: the offset of the drag is done with, in the same frame
  useLayoutEffect(() => {
    element.current?.style.removeProperty('transform');
  }, [item.x, item.y]);

  return (
    <div
      ref={element}
      className={`workspace-object workspace-${item.kind}`}
      data-id={item.id}
      aria-selected={isSelected}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        // The same width on the screen at every zoom
        outlineWidth: isSelected ? RING_PIXELS / zoom : undefined,
        visibility: isCropped ? 'hidden' : undefined,
      }}
    >
      {item.kind === 'image' ? (
        <WorkspaceImage item={item} source={source} zoom={zoom} />
      ) : item.kind === 'text' ? (
        <WorkspaceText item={item} ink={ink} />
      ) : (
        // A background is its colour
        <div className="workspace-paper" style={{ background: item.color }} />
      )}
      {isSizable && (
        <div
          className="workspace-resize"
          style={{ width: HANDLE_PIXELS / zoom, height: HANDLE_PIXELS / zoom }}
          aria-label="Drag to make it larger or smaller"
        />
      )}
    </div>
  );
});

export default WorkspaceObject;

/**
 * Around everything that is selected, when that is more than one: a thin frame with the handle that sizes
 * them all together (`WorkspaceSurface`, the 'scale' gesture). It takes no clicks but on its handle.
 */
export function SelectionFrame({ bounds, zoom }: { bounds: Rect; zoom: number }): JSX.Element {
  return (
    <div
      className="workspace-selection-frame"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        outlineWidth: RING_PIXELS / zoom,
      }}
    >
      <div
        className="workspace-resize workspace-group-resize"
        style={{ width: HANDLE_PIXELS / zoom, height: HANDLE_PIXELS / zoom }}
        aria-label="Drag to make what is selected larger or smaller (or Alt and the wheel)"
      />
    </div>
  );
}

/**
 * Where the whole photo lies in a frame that shows the part `crop` of it, as a style: the frame cuts off
 * the rest
 */
export function photoInFrame(crop: Crop): React.CSSProperties {
  return {
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
  };
}

/** An image, the part of its photo it shows (`cropOf`), with as many pixels as it takes up on the screen */
function WorkspaceImage(props: {
  item: WorkspaceImageItem;
  source: WorkspaceImageSource | undefined;
  zoom: number;
}) {
  const { item, source, zoom } = props;
  const crop = cropOf(item);
  // As sharp as the whole photo is large on the screen: a small part of it is shown large
  const sharpSrc = useSharpSource(
    source,
    (item.width / crop.width) * zoom,
    (item.height / crop.height) * zoom,
  );
  const src = sharpSrc ?? source?.src;
  // Broken for this source only: a thumbnail that was not made yet, or a sharp one, may still come
  const [brokenSrc, setBrokenSrc] = useState<string>();
  if (source === undefined) {
    return null;
  }
  const isBroken = brokenSrc !== undefined && brokenSrc === src;
  return isBroken ? (
    <span className="workspace-image-name">{source.name}</span>
  ) : (
    <div className="workspace-image-crop">
      <img
        src={src}
        alt={source.name}
        style={photoInFrame(crop)}
        decoding="async"
        draggable={false}
        onError={() => setBrokenSrc(src)}
      />
    </div>
  );
}

/** A text, in the letters it was measured in (`measureText`), so that its frame fits around it */
function WorkspaceText({ item, ink }: { item: WorkspaceTextItem; ink?: string }): JSX.Element {
  return (
    <span
      style={{
        fontSize: item.fontSize,
        fontWeight: TEXT_FONT_WEIGHT,
        lineHeight: TEXT_LINE_HEIGHT,
        color: ink,
      }}
    >
      {item.text}
    </span>
  );
}

/**
 * The image drawn with as many pixels as it covers on the screen, when its thumbnail has fewer: drawn at
 * that size in the background by the workers of `SharpImages`, and from the size of the image itself on,
 * the file itself. Only swapped in once it is decoded, so that it never blinks; until then, and when it
 * becomes small again, the thumbnail.
 */
export function useSharpSource(
  source: WorkspaceImageSource | undefined,
  screenWidth: number,
  screenHeight: number,
): string | undefined {
  const [sharpSrc, setSharpSrc] = useState<string>();
  const size =
    source !== undefined
      ? getSharpSize(source.file, screenWidth, screenHeight, 'cover', window.devicePixelRatio)
      : undefined;
  const isFullSize = size !== undefined && size.width >= source!.file.width;
  const sizeKey =
    size === undefined ? 'thumbnail' : isFullSize ? 'full' : `${size.width}x${size.height}`;

  useEffect(() => {
    if (source === undefined || size === undefined) {
      // Small again: the thumbnail, and the large picture can be let go of
      setSharpSrc(undefined);
      return;
    }
    let isWanted = true;
    let cancel = () => undefined as void;
    // Only once the size holds for a moment: while a slider of Arrange moves, sizes change in every frame
    const timer = setTimeout(() => {
      const request = isFullSize
        ? {
            promise: Promise.resolve(encodeFilePath(source.file.absolutePath)),
            cancel: () => undefined,
          }
        : sharpImages.request(source.file, size);
      cancel = request.cancel;
      request.promise
        .then(async (url) => {
          const preload = new Image();
          preload.src = url;
          await preload.decode();
          if (isWanted) {
            setSharpSrc(url);
          }
        })
        .catch(() => undefined); // the thumbnail stays
    }, SHARP_DELAY);
    return () => {
      isWanted = false;
      clearTimeout(timer);
      cancel();
    };
    // Only when the size it needs changes, not with every new object for the same size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sizeKey]);

  return sharpSrc;
}

import { clipboard, shell, webFrame } from 'electron';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { encodeFilePath } from 'common/fs';
import { SHARP_DECODABLE } from 'common/sharp-size';
import {
  fileNameOfPath,
  foldersOf,
  inspectorPlace,
  ScreenRect,
  windowFeatures,
} from 'common/tag-inspection';
import { IconSet } from 'widgets';
import { FileDTO } from '../../api/file';
import PopupWindow from '../components/PopupWindow';
import { useStore } from '../contexts/StoreContext';
import { ClientTag } from '../entities/Tag';

/** The height of a row in the list of images, in pixels: the list draws only the rows in sight */
const IMAGE_ROW_HEIGHT = 48;
const SPARE_ROWS = 8;

/**
 * A window with what there is to know about a tag (right click on a tag, Inspect): how many images it holds,
 * from how many folders, which folders, and, opened, every image with its path. Hovering the small picture of
 * an image shows it large in a window of its own beside this one; moving on to the rows above or below
 * shows theirs. Nothing is changed: everything is read from the database.
 */
const TagInspector = observer(() => {
  const { uiStore } = useStore();
  const tag = uiStore.inspectedTag;
  if (tag === undefined) {
    return null;
  }
  return (
    <PopupWindow
      onClose={uiStore.closeTagInspector}
      windowName="tag-inspector"
      closeOnEscape
      features={windowFeatures(inspectorPlace(galleryOnScreen(), workAreaOf(window)))}
    >
      <div id="tag-inspector" className={uiStore.theme}>
        <Details key={tag.id} tag={tag} />
      </div>
    </PopupWindow>
  );
});

export default TagInspector;

/** The work area of the screen a window is on (without the taskbar), in pixels of the system */
function workAreaOf(win: Window): ScreenRect {
  const screen = win.screen as Screen & { availLeft: number; availTop: number };
  return {
    x: screen.availLeft,
    y: screen.availTop,
    width: screen.availWidth,
    height: screen.availHeight,
  };
}

/** Where a window is on the screen, frame and all */
function windowOnScreen(win: Window): ScreenRect {
  return { x: win.screenX, y: win.screenY, width: win.outerWidth, height: win.outerHeight };
}

/**
 * Where the gallery of the main window is on the screen: its place in the page, scaled by the zoom of the
 * app, from the top left of the page inside the window's frame
 */
function galleryOnScreen(): ScreenRect {
  const gallery = document.getElementById('gallery-content')?.getBoundingClientRect();
  const zoom = webFrame.getZoomFactor();
  const border = (window.outerWidth - window.innerWidth * zoom) / 2;
  const pageTop = window.screenY + (window.outerHeight - window.innerHeight * zoom) - border;
  const pageLeft = window.screenX + border;
  return gallery === undefined
    ? windowOnScreen(window)
    : {
        x: pageLeft + gallery.left * zoom,
        y: pageTop + gallery.top * zoom,
        width: gallery.width * zoom,
        height: gallery.height * zoom,
      };
}

/** A path of a file or a folder, for the menu of the inspector: shown in Explorer, or copied */
interface PathTarget {
  path: string;
  isFolder: boolean;
}

/** Explorer (or Finder) opened at the file or folder: it is only looked at, nothing is changed */
function reveal({ path, isFolder }: PathTarget) {
  if (isFolder) {
    shell.openPath(path);
  } else {
    shell.showItemInFolder(path);
  }
}

/** A button that copies a path, and shows for a moment that it did */
function CopyPathButton({ path }: { path: string }) {
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isCopied]);
  return (
    <button
      className="tag-inspector-copy"
      aria-label="Copy the path"
      data-copied={isCopied}
      onClick={(event) => {
        event.stopPropagation();
        clipboard.writeText(path);
        setIsCopied(true);
      }}
    >
      {isCopied ? IconSet.CHECK : IconSet.COPY}
      <span>{isCopied ? 'Copied' : 'Copy path'}</span>
    </button>
  );
}

/** The menu of a right click on a folder or an image: show it in Explorer, or copy its path */
function PathMenu({
  target,
  at,
  onClose,
}: {
  target: PathTarget;
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const win = menu.current?.ownerDocument.defaultView;
    const close = (event: Event) => {
      if (
        !(event.target as { closest?: (s: string) => Element | null }).closest?.(
          '.tag-inspector-menu',
        )
      ) {
        onClose();
      }
    };
    const closeOnKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    win?.addEventListener('mousedown', close);
    win?.addEventListener('keydown', closeOnKey, true);
    win?.addEventListener('blur', onClose);
    return () => {
      win?.removeEventListener('mousedown', close);
      win?.removeEventListener('keydown', closeOnKey, true);
      win?.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div ref={menu} className="tag-inspector-menu" role="menu" style={{ left: at.x, top: at.y }}>
      <button
        role="menuitem"
        onClick={() => {
          reveal(target);
          onClose();
        }}
      >
        {IconSet.FOLDER_OPEN}
        {target.isFolder ? 'Open the folder' : 'Show in folder'}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          clipboard.writeText(target.path);
          onClose();
        }}
      >
        {IconSet.COPY}
        Copy path
      </button>
    </div>
  );
}

const Details = observer(({ tag }: { tag: ClientTag }) => {
  const { tagStore } = useStore();
  const [images, setImages] = useState<FileDTO[]>();
  const [isExpanded, setIsExpanded] = useState(false);
  const [menu, setMenu] = useState<{ target: PathTarget; at: { x: number; y: number } }>();
  const openMenu = (event: React.MouseEvent, target: PathTarget) => {
    event.preventDefault();
    setMenu({ target, at: { x: event.clientX, y: event.clientY } });
  };

  useEffect(() => {
    let isWanted = true;
    tagStore
      .fetchImagesOf(tag)
      .then((found) => isWanted && setImages(found))
      .catch((e) => console.error('Could not read the images of the tag', e));
    return () => {
      isWanted = false;
    };
  }, [tag, tagStore]);

  const folders = useMemo(
    () => (images === undefined ? [] : foldersOf(images.map((image) => image.absolutePath))),
    [images],
  );
  const subTagCount = tag.subTags.length;

  return (
    <div className="tag-inspector">
      <header>
        <span className="tag-inspector-swatch" style={{ background: tag.viewColor || undefined }}>
          {IconSet.TAG}
        </span>
        <div>
          <h1>{tag.name}</h1>
          {tag.path.length > 1 && (
            <div className="tag-inspector-parents">{tag.path.slice(0, -1).join(' › ')}</div>
          )}
        </div>
      </header>
      <nav className="tag-inspector-tabs">
        <button aria-current="page">Details</button>
      </nav>

      <section className="tag-inspector-stats">
        <div>
          <strong>{images === undefined ? '…' : images.length.toLocaleString()}</strong>
          <span>{images?.length === 1 ? 'image' : 'images'}</span>
        </div>
        <div>
          <strong>{images === undefined ? '…' : folders.length.toLocaleString()}</strong>
          <span>{folders.length === 1 ? 'folder' : 'folders'}</span>
        </div>
        {subTagCount > 0 && (
          <div>
            <strong>{subTagCount.toLocaleString()}</strong>
            <span>{subTagCount === 1 ? 'sub-tag, counted in' : 'sub-tags, counted in'}</span>
          </div>
        )}
      </section>

      {!isExpanded && (
        <section className="tag-inspector-folders">
          <h2>Folders</h2>
          <ul>
            {folders.map((folder) => (
              <li
                key={folder.path}
                onContextMenu={(event) => openMenu(event, { path: folder.path, isFolder: true })}
                onDoubleClick={() => reveal({ path: folder.path, isFolder: true })}
              >
                <span className="tag-inspector-path" title={folder.path}>
                  {folder.path}
                </span>
                <CopyPathButton path={folder.path} />
                <span className="tag-inspector-count">{folder.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {images !== undefined && images.length > 0 && (
        <button className="tag-inspector-expand" onClick={() => setIsExpanded((open) => !open)}>
          {isExpanded ? IconSet.ARROW_UP : IconSet.ARROW_DOWN}
          {isExpanded
            ? 'Back to the folders'
            : `Show all ${images.length.toLocaleString()} images and their paths`}
        </button>
      )}

      {isExpanded && images !== undefined && (
        <ImageList
          images={images}
          onMenu={(event, image) => openMenu(event, { path: image.absolutePath, isFolder: false })}
        />
      )}
      {menu !== undefined && (
        <PathMenu target={menu.target} at={menu.at} onClose={() => setMenu(undefined)} />
      )}
    </div>
  );
});

/**
 * Every image, with a small picture and its path, of which only the rows in sight are drawn. Hovering a small
 * picture opens the large preview beside the window; while it is open, the row under the pointer is shown in it.
 */
const ImageList = observer(
  ({
    images,
    onMenu,
  }: {
    images: FileDTO[];
    /** A right click on an image: the menu to show it in its folder or copy its path */
    onMenu: (event: React.MouseEvent, image: FileDTO) => void;
  }) => {
    const { uiStore, imageLoader } = useStore();
    const list = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(400);
    const [previewed, setPreviewed] = useState<FileDTO>();

    useLayoutEffect(() => {
      const element = list.current!;
      // The resize observer of the window the list is in
      const observer = new (element.ownerDocument.defaultView ?? window).ResizeObserver(() =>
        setHeight(element.clientHeight),
      );
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const first = Math.max(0, Math.floor(scrollTop / IMAGE_ROW_HEIGHT) - SPARE_ROWS);
    const last = Math.min(
      images.length,
      Math.ceil((scrollTop + height) / IMAGE_ROW_HEIGHT) + SPARE_ROWS,
    );
    const thumbnailOf = (image: FileDTO) =>
      encodeFilePath(imageLoader.shownPathOf(image, uiStore.thumbnailDirectory));

    return (
      <section
        ref={list}
        className="tag-inspector-images"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onMouseLeave={() => setPreviewed(undefined)}
      >
        <div style={{ height: images.length * IMAGE_ROW_HEIGHT, position: 'relative' }}>
          {images.slice(first, last).map((image, i) => (
            <div
              key={image.id}
              className="tag-inspector-image"
              aria-current={image === previewed}
              style={{ top: (first + i) * IMAGE_ROW_HEIGHT, height: IMAGE_ROW_HEIGHT }}
              // Once the preview is open, the row under the pointer is shown in it
              onMouseEnter={() => previewed !== undefined && setPreviewed(image)}
              onContextMenu={(event) => {
                setPreviewed(undefined);
                onMenu(event, image);
              }}
            >
              <span className="tag-inspector-thumbnail" onMouseEnter={() => setPreviewed(image)}>
                <img
                  src={thumbnailOf(image)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onError={(event) => (event.currentTarget.style.visibility = 'hidden')}
                />
              </span>
              <span className="tag-inspector-image-text">
                <span className="tag-inspector-name">{image.name}</span>
                <span className="tag-inspector-path" title={image.absolutePath}>
                  {image.absolutePath}
                </span>
              </span>
              <CopyPathButton path={image.absolutePath} />
            </div>
          ))}
        </div>
        {previewed !== undefined && (
          <Preview image={previewed} thumbnail={thumbnailOf(previewed)} />
        )}
      </section>
    );
  },
);

/**
 * The large preview, in a window of its own as large as the inspector, beside it: on its right, or on its
 * left when there is no room on the right of its screen. Placed by the main process (`previewPlace`),
 * which knows how large the frame of the inspector is.
 */
const Preview = observer(({ image, thumbnail }: { image: FileDTO; thumbnail: string }) => {
  const { uiStore } = useStore();
  // The file itself where the browser can read it; the thumbnail for other formats (TIFF, PSD...)
  const src = SHARP_DECODABLE.has(image.extension) ? encodeFilePath(image.absolutePath) : thumbnail;
  return (
    <PopupWindow windowName="tag-inspector-preview" onClose={() => undefined}>
      <div id="tag-inspector-preview" className={uiStore.theme}>
        {/* The same element for every image: it keeps the last one until the next is decoded */}
        <img src={src} alt={image.name} decoding="async" draggable={false} />
        <div className="tag-inspector-preview-caption">
          <span>{fileNameOfPath(image.absolutePath)}</span>
          <span>
            {image.width.toLocaleString()} × {image.height.toLocaleString()}
          </span>
        </div>
      </div>
    </PopupWindow>
  );
});

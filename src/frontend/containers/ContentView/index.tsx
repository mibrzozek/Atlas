import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';

import { useStore } from '../../contexts/StoreContext';

import { IconSet } from 'widgets';
import { MenuSubItem, Menu, useContextMenu } from 'widgets/menus';

import Placeholder from './Placeholder';
import Layout from './LayoutSwitcher';

import { LayoutMenuItems, SortMenuItems } from '../AppToolbar/Menus';
import { useTagDnD } from 'src/frontend/contexts/TagDnDContext';
import { MoveFilesToTrashBin } from 'src/frontend/components/RemovalAlert';
import { useAction } from 'src/frontend/hooks/mobx';
import useIsWindowMaximized from 'src/frontend/hooks/useIsWindowMaximized';
import { ManyOpenExternal } from 'src/frontend/components/WarningAlert';
import WorkspaceView from '../Workspace/WorkspaceView';

/** How far the wheel turns for one notch, as browsers report it */
const WHEEL_NOTCH = 100;

const ContentView = observer(() => {
  const { uiStore, fileStore } = useStore();
  const { fileList } = fileStore;
  const workspace = uiStore.activeWorkspace;

  return (
    <div
      id="content-view"
      className={`thumbnail-${uiStore.thumbnailSize} thumbnail-${uiStore.thumbnailShape} ${
        fileStore.isCollageMode ? 'collage' : ''
      } ${fileStore.isCollageAnimating ? 'collage-animating' : ''}`}
    >
      {fileList.length === 0 ? <Placeholder /> : <Content />}
      {/* Over the Library, which stays as it is underneath */}
      {workspace !== undefined && <WorkspaceView key={workspace.id} workspace={workspace} />}
    </div>
  );
});

const Content = observer(() => {
  const { fileStore, uiStore } = useStore();
  const dndData = useTagDnD();
  const { fileList } = fileStore;
  const [contentRect, setContentRect] = useState({ width: 1, height: 1 });
  const container = useRef<HTMLDivElement>(null);
  const isMaximized = useIsWindowMaximized();

  const show = useContextMenu();
  const handleContextMenu = useAction((e: React.MouseEvent) => {
    if (!uiStore.isSlideMode) {
      show(
        e.clientX,
        e.clientY,
        <Menu>
          <MenuSubItem icon={IconSet.VIEW_GRID} text="View method...">
            <LayoutMenuItems />
          </MenuSubItem>
          <MenuSubItem icon={IconSet.FILTER_NAME_DOWN} text="Sort by...">
            <SortMenuItems />
          </MenuSubItem>
        </Menu>,
      );
    }
  });

  const resizeObserver = useRef(
    new ResizeObserver((entries) => {
      const {
        contentRect: { width, height },
      } = entries[0];
      setContentRect({ width, height });
      // As wide as a workspace lays out what it is given from the Library
      uiStore.galleryWidth = (entries[0].target as HTMLElement).clientWidth;
    }),
  );

  // Ctrl + mouse wheel makes the thumbnails larger or smaller, instead of zooming the whole window.
  // Not through React: its wheel listeners cannot stop the browser's own zoom
  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    // A touchpad sends many small amounts: they add up to a notch, until the wheel turns the other way
    let pending = 0;
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || uiStore.isSlideMode) {
        return;
      }
      event.preventDefault();
      if (Math.sign(pending) === Math.sign(event.deltaY)) {
        pending = 0;
      }
      pending -= event.deltaY;
      const notches = Math.trunc(pending / WHEEL_NOTCH);
      if (notches !== 0) {
        pending -= notches * WHEEL_NOTCH;
        uiStore.growThumbnails(notches);
      }
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [uiStore]);

  useEffect(() => {
    const observer = resizeObserver.current;
    if (container.current) {
      resizeObserver.current.observe(container.current);
    }
    return () => observer.disconnect();
  }, [fileList.length]);

  const isDroppingTagOnSelection =
    dndData.target !== undefined && uiStore.fileSelection.has(dndData.target);

  const clearFileSelection = useAction((e: React.MouseEvent | React.KeyboardEvent) => {
    const isLayout = e.currentTarget.firstElementChild?.contains(e.target as Node);
    if (!uiStore.isSlideMode && isLayout) {
      uiStore.clearFileSelection();
    }
  });

  const handleKeyDown = useAction((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!uiStore.isSlideMode) {
        uiStore.clearFileSelection();
        e.stopPropagation();
      }
    }
  });

  return (
    <div
      ref={container}
      id="gallery-content"
      className={isMaximized ? '' : 'unmaximized'}
      tabIndex={-1}
      data-show-overlay={
        uiStore.isThumbnailFilenameOverlayEnabled || uiStore.isThumbnailResolutionOverlayEnabled
      }
      data-selected-file-dropping={isDroppingTagOnSelection}
      onContextMenu={handleContextMenu}
      // Clear selection when clicking on the background, unless in slide mode: always needs an active image
      onClick={clearFileSelection}
      onKeyDown={handleKeyDown}
    >
      <Layout contentRect={contentRect} />
      <MoveFilesToTrashBin />
      <ManyOpenExternal />
    </div>
  );
});

Content.displayName = 'Gallery';

export default ContentView;

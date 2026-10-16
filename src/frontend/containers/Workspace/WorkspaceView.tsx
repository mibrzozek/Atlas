import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { isStartCamera, textInk, WorkspaceItem } from 'common/workspace';
import { useStore } from '../../contexts/StoreContext';
import { comboMatches, getKeyCombo, parseKeyCombo } from '../../hotkeyParser';
import { ClientWorkspace } from '../../entities/Workspace';
import LayersPanel from './LayersPanel';
import { carriesLibraryBatch, dropEffectFor, readLibraryBatch } from './libraryDrop';
import WorkspaceObject from './WorkspaceObject';
import { WorkspaceImages } from './WorkspaceImages';
import { VisibleItems, WorkspaceSurface } from './WorkspaceSurface';

/**
 * A workspace on screen, over the Library (which stays as it was underneath, scroll position and all), with
 * its layers panel next to it. The surface (`WorkspaceSurface`) moves the camera; this only puts what is
 * in view in the page.
 */
const WorkspaceView = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const { uiStore, workspaceStore } = useStore();
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backgroundWorld = useRef<HTMLDivElement>(null);
  const tileCanvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<WorkspaceSurface>();
  const [visible, setVisible] = useState<VisibleItems>({ ids: new Set() });
  // Prepared by the store when the workspace was opened, and kept while switching tabs
  const images = workspaceStore.imagesOf(workspace)!;
  // Images are given their pixels for the zoom once the camera has stopped, not in every frame
  const [settledZoom, setSettledZoom] = useState(workspace.camera.zoom);
  // While a tag, collection, folder or images of the Library are held over it
  const [isDropTarget, setIsDropTarget] = useState(false);

  useEffect(() => {
    const created = new WorkspaceSurface(
      viewport.current!,
      world.current!,
      canvas.current!,
      backgroundWorld.current!,
      tileCanvas.current!,
      workspace,
      images.tiles,
      {
        onVisibleChange: setVisible,
        onSettle: (camera) => {
          workspace.setCamera(camera);
          setSettledZoom(camera.zoom);
        },
        onEditText: uiStore.editWorkspaceText,
      },
    );
    surface.current = created;
    workspaceStore.surface = created;
    // What is on it, whenever that changes
    const stopFollowing = reaction(
      () => workspace.items.slice(),
      (items) => created.setItems(items),
      { fireImmediately: true },
    );
    // A workspace that was never looked at opens with everything on it in view
    if (isStartCamera(workspace.camera)) {
      created.fitEverything();
    }
    return () => {
      stopFollowing();
      created.dispose();
      if (workspaceStore.surface === created) {
        workspaceStore.surface = undefined;
      }
    };
  }, [workspace, workspaceStore, images, uiStore]);

  const grid = uiStore.workspaceGrid;
  useEffect(() => surface.current?.setGrid(grid), [grid]);

  // The keys are in Settings, Shortcuts; Backspace, Escape and copying always do what they do
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const combo = getKeyCombo(event.nativeEvent);
    const { hotkeyMap } = uiStore;
    const matches = (keys: string) => comboMatches(combo, parseKeyCombo(keys));
    if (matches(hotkeyMap.deleteSelection) || event.key === 'Backspace') {
      workspace.removeSelected();
    } else if (matches(hotkeyMap.redo)) {
      workspace.redo();
    } else if (matches(hotkeyMap.undo)) {
      workspace.undo();
    } else if (matches(hotkeyMap.selectAll)) {
      workspace.selectAll();
    } else if (event.key === 'Escape') {
      workspace.clearSelection();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      workspaceStore.copy(workspace);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      if (surface.current !== undefined) {
        workspaceStore.paste(workspace, surface.current.middle);
      }
    } else if (matches(hotkeyMap.workspaceLock)) {
      workspace.toggleLock();
    } else if (matches(hotkeyMap.workspaceGrid)) {
      uiStore.toggleWorkspaceGrid();
    } else if (matches(hotkeyMap.workspaceFitAll)) {
      surface.current?.fitEverything();
    } else if (matches(hotkeyMap.workspaceActualSize)) {
      // Before the menu's Ctrl+0, which would set the zoom of the whole window
      surface.current?.zoomToActualSize();
    } else if (matches(hotkeyMap.workspaceSwap)) {
      workspace.swapSelection();
    } else if (matches(hotkeyMap.workspaceAddText)) {
      const id = surface.current?.addText();
      if (id !== undefined) {
        uiStore.editWorkspaceText(id);
      }
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const { selection, isLocked } = workspace;
  const shown: WorkspaceItem[] = [];
  const backgrounds: WorkspaceItem[] = [];
  for (const item of workspace.items.slice()) {
    if (visible.ids.has(item.id)) {
      (item.kind === 'background' ? backgrounds : shown).push(item);
    }
  }
  // Back to front by their order in the page, not by z-index: a z-index makes every image a layer of its
  // own, which the browser has to sort out again in every frame of a zoom
  shown.sort((a, b) => a.z - b.z);
  backgrounds.sort((a, b) => a.z - b.z);
  const objectOf = (item: WorkspaceItem) => (
    <WorkspaceObject
      key={item.id}
      item={item}
      source={item.kind === 'image' ? images.sources.get(item.fileId) : undefined}
      zoom={settledZoom}
      isSelected={selection.has(item.id)}
      isSizable={!isLocked && selection.size === 1 && selection.has(item.id)}
      // A sheet under a text in view is in view too
      ink={item.kind === 'text' ? textInk(item, backgrounds) : undefined}
    />
  );

  return (
    <div className="workspace-area">
      <div
        ref={viewport}
        className="workspace"
        tabIndex={-1}
        aria-label={workspace.name}
        data-locked={isLocked}
        data-drop-target={isDropTarget}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          if (!isLocked && carriesLibraryBatch(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer);
            setIsDropTarget(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDropTarget(false);
          }
        }}
        onDrop={(event) => {
          setIsDropTarget(false);
          const batch = readLibraryBatch(event.dataTransfer, workspaceStore.rootStore);
          if (batch !== undefined && surface.current !== undefined) {
            event.preventDefault();
            // Its top left where it was let go
            workspaceStore.addBatch(workspace, batch, surface.current.worldAt(event));
            viewport.current?.focus();
          }
        }}
      >
        {/* From the bottom: the grid, the backgrounds, the tiles of small images, everything else */}
        <canvas ref={canvas} className="workspace-backdrop" />
        <div ref={backgroundWorld} className="workspace-world">
          {backgrounds.map(objectOf)}
        </div>
        <canvas ref={tileCanvas} className="workspace-backdrop" />
        <div ref={world} className="workspace-world">
          {shown.map(objectOf)}
        </div>
        <PreparingOverlay images={images} />
      </div>
      {uiStore.isWorkspaceLayersOpen && <LayersPanel workspace={workspace} images={images} />}
    </div>
  );
});

/**
 * While the images of a large workspace are still being prepared: how far it got, in the middle of the
 * surface. It fades in only after a moment, so that a small workspace that is ready at once never shows it.
 */
const PreparingOverlay = observer(({ images }: { images: WorkspaceImages }) => {
  const { progress } = images;
  return (
    <div className="workspace-preparing" data-active={progress !== undefined} aria-live="polite">
      {progress !== undefined && (
        <>
          <div className="workspace-spinner" />
          <span>
            Preparing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} images
          </span>
        </>
      )}
    </div>
  );
});

export default WorkspaceView;

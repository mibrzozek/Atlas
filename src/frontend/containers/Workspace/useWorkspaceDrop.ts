import React, { useEffect, useRef, useState } from 'react';

import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import { carriesLibraryBatch, dropEffectFor, readLibraryBatch } from './libraryDrop';

/** Marks a drag of a workspace (a tab, or a row of the Workspaces panel) to another place among them */
const WORKSPACE_DND_TYPE = 'application/x-atlas-workspace';
/** How long something of the Library is held over a workspace before it opens, to drop it in place */
const OPEN_ON_HOLD = 700;

/**
 * Where a drop would land: another workspace before or after this one, or something of the Library
 * (a tag, a collection, a folder, images) into it
 */
export type WorkspaceDropMark = 'before' | 'after' | 'into';

/**
 * Dragging a workspace among the others, and dropping things of the Library on it, which adds them next
 * to what is there; held over it a moment, it opens. For its tab (`'horizontal'`, before is left) and its
 * row in the side panel (`'vertical'`, before is above). The props go on that element.
 */
export function useWorkspaceDrop(
  workspace: ClientWorkspace,
  direction: 'horizontal' | 'vertical',
  canDrag: boolean,
) {
  const { uiStore, workspaceStore } = useStore();
  const [mark, setMark] = useState<WorkspaceDropMark>();
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(openTimer.current), []);

  const stopHolding = () => {
    clearTimeout(openTimer.current);
    openTimer.current = undefined;
    setMark(undefined);
  };

  const sideOf = (event: React.DragEvent): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect();
    return direction === 'horizontal'
      ? event.clientX < rect.left + rect.width / 2
        ? 'before'
        : 'after'
      : event.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after';
  };

  const props = {
    draggable: canDrag,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(WORKSPACE_DND_TYPE, workspace.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (event: React.DragEvent) => {
      if (event.dataTransfer.types.includes(WORKSPACE_DND_TYPE)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setMark(sideOf(event));
      } else if (!workspace.isLocked && carriesLibraryBatch(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer);
        setMark('into');
        if (openTimer.current === undefined && workspace !== uiStore.activeWorkspace) {
          openTimer.current = setTimeout(() => uiStore.openWorkspace(workspace), OPEN_ON_HOLD);
        }
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        stopHolding();
      }
    },
    onDrop: (event: React.DragEvent) => {
      stopHolding();
      const batch = readLibraryBatch(event.dataTransfer, workspaceStore.rootStore);
      if (batch !== undefined) {
        event.preventDefault();
        workspaceStore.addBatch(workspace, batch);
        return;
      }
      const dragged = workspaceStore.workspaceList.find(
        (w) => w.id === event.dataTransfer.getData(WORKSPACE_DND_TYPE),
      );
      if (dragged !== undefined && dragged !== workspace) {
        event.preventDefault();
        workspaceStore.moveNextTo(dragged, workspace, sideOf(event));
      }
    },
  };

  return { mark, props };
}

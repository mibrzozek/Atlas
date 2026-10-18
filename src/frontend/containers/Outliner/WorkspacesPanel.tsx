import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';

import { IconSet } from 'widgets';
import MultiSplitPane, { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import { useWorkspaceDrop } from '../Workspace/useWorkspaceDrop';
import { useWorkspaceMenu } from '../Workspace/WorkspaceTabs';
import { WorkspaceNameInput } from '../Workspace/WorkspaceNameInput';

/** How a drop on a row is shown: a line above or below it, or the whole row lit for adding to it */
const MARK_CLASS = { before: 'top', after: 'bottom', into: 'center' } as const;

/**
 * A workspace in the side panel, as its tab behaves: a click opens it, a double click (or F2) renames
 * it, a drag moves it among the others, and a tag, collection, folder or images dropped on it are added.
 * A click also brings back its tab when that was closed; a right click renames, closes the tab or deletes.
 */
const WorkspaceRow = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const { uiStore } = useStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const { mark, props: dnd } = useWorkspaceDrop(workspace, 'vertical', !isRenaming);
  const isOpen = workspace === uiStore.activeWorkspace;
  const imageCount = workspace.fileIds.length;
  const showMenu = useWorkspaceMenu(workspace, () => setIsRenaming(true));

  return (
    <li role="treeitem" aria-selected={isOpen} className={isOpen ? 'searched' : undefined}>
      <div
        className={`tree-content-label workspace-row ${mark !== undefined ? MARK_CLASS[mark] : ''}`}
        data-dnd-target={mark !== undefined || undefined}
        tabIndex={-1}
        onClick={() => uiStore.openWorkspace(workspace)}
        onDoubleClick={() => setIsRenaming(true)}
        onContextMenu={showMenu}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            setIsRenaming(true);
          }
        }}
        {...dnd}
      >
        <span>{IconSet.WORKSPACE}</span>
        {isRenaming ? (
          <WorkspaceNameInput
            workspace={workspace}
            className="label-text"
            onDone={() => setIsRenaming(false)}
          />
        ) : (
          <div className="label-text">{workspace.name}</div>
        )}
        <span
          className="collection-count"
          data-tooltip={`${imageCount.toLocaleString()} ${imageCount === 1 ? 'image' : 'images'}`}
        >
          {imageCount.toLocaleString()}
        </span>
      </div>
    </li>
  );
});

/** The workspaces, in the order of their tabs */
const WorkspacesPanel = observer((props: Partial<MultiSplitPaneProps>) => {
  const { workspaceStore } = useStore();
  const workspaces = workspaceStore.workspaceList;

  return (
    <MultiSplitPane
      id="workspaces"
      title="Workspaces"
      headerToolbar={
        <Toolbar controls="workspace-list" isCompact>
          <ToolbarButton
            icon={IconSet.PLUS}
            text="New workspace"
            onClick={workspaceStore.createFromLibrary}
            tooltip="New workspace with the images the Library shows"
          />
        </Toolbar>
      }
      {...props}
    >
      {workspaces.length === 0 ? (
        <div className="tree-content-label" style={{ padding: '0.25rem' }}>
          <i style={{ marginLeft: '1em' }}>None</i>
        </div>
      ) : (
        <ul id="workspace-list" role="tree">
          {workspaces.map((workspace) => (
            <WorkspaceRow key={workspace.id} workspace={workspace} />
          ))}
        </ul>
      )}
    </MultiSplitPane>
  );
});

export default WorkspacesPanel;

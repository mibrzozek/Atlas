import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import MultiSplitPane, { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';

/** The workspaces, in the order of their tabs. A click opens one */
const WorkspacesPanel = observer((props: Partial<MultiSplitPaneProps>) => {
  const { uiStore, workspaceStore } = useStore();
  const workspaces = workspaceStore.workspaceList;
  const active = uiStore.activeWorkspace;

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
            <li
              key={workspace.id}
              role="treeitem"
              aria-selected={workspace === active}
              className={workspace === active ? 'searched' : undefined}
            >
              <div className="tree-content-label" onClick={() => uiStore.openWorkspace(workspace)}>
                <span>{IconSet.WORKSPACE}</span>
                <div className="label-text">{workspace.name}</div>
                <span className="collection-count">{workspace.items.length}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </MultiSplitPane>
  );
});

export default WorkspacesPanel;

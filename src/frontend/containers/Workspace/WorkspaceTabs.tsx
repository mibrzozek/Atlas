import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { IconSet } from 'widgets';
import { Menu, MenuDivider, MenuItem, useContextMenu } from 'widgets/menus';
import { Alert, DialogButton } from 'widgets/popovers';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import { useWorkspaceDrop } from './useWorkspaceDrop';
import { WorkspaceNameInput } from './WorkspaceNameInput';

/**
 * The Library and the open workspaces, as tabs in the top bar, and a + that makes a workspace of the
 * images the Library shows. Opening one changes nothing else in the window. Like a browser's, the tabs
 * get narrower as there are more of them, and closing one leaves the workspace in the Workspaces panel.
 */
const WorkspaceTabs = observer(() => {
  const { uiStore, workspaceStore } = useStore();
  const active = uiStore.activeWorkspace;
  const strip = useRef<HTMLDivElement>(null);

  // The open tab in sight, also when the tabs are at their narrowest and do not all fit
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, uiStore.workspaceTabs.length]);

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Library and workspaces">
      <button
        role="tab"
        className="workspace-tab workspace-tab-library"
        aria-selected={active === undefined}
        onClick={uiStore.openLibrary}
        data-tooltip="Your images"
      >
        {IconSet.MEDIA}
        <span className="workspace-tab-name">Library</span>
      </button>
      <div
        ref={strip}
        className="workspace-tab-strip"
        role="none"
        // The wheel scrolls through tabs that do not fit
        onWheel={(event) => (event.currentTarget.scrollLeft += event.deltaY + event.deltaX)}
      >
        {uiStore.workspaceTabs.map((workspace) => (
          <WorkspaceTab key={workspace.id} workspace={workspace} isActive={workspace === active} />
        ))}
      </div>
      <button
        className="workspace-tab-add btn-icon"
        onClick={workspaceStore.createFromLibrary}
        aria-label="New workspace"
        data-tooltip="New workspace with the images the Library shows"
      >
        {IconSet.PLUS}
      </button>
      <DeleteWorkspaceAlert />
      <LargeWorkspaceAlert />
    </div>
  );
});

/** Asked before a workspace is deleted (its right-click menu, in a tab or the Workspaces panel) */
const DeleteWorkspaceAlert = observer(() => {
  const { uiStore, workspaceStore } = useStore();
  const workspace = uiStore.workspaceToDelete;
  if (workspace === undefined) {
    return null;
  }
  return (
    <Alert
      open
      title={`Delete the workspace "${workspace.name}"?`}
      icon={IconSet.WARNING}
      type="warning"
      primaryButtonText="Delete"
      defaultButton={DialogButton.CloseButton}
      onClick={(button) => {
        if (button === DialogButton.PrimaryButton) {
          workspaceStore.remove(workspace);
        }
        uiStore.closeDeleteWorkspace();
      }}
    >
      <p>How its images are arranged is lost. The images themselves stay in your library.</p>
    </Alert>
  );
});

/**
 * The right-click menu of a workspace, the same on its tab and its row in the Workspaces panel: rename,
 * close the tab, delete. Deleting is only here, and asks first.
 */
export function useWorkspaceMenu(workspace: ClientWorkspace, startRenaming: () => void) {
  const { uiStore } = useStore();
  const showMenu = useContextMenu();
  return (event: React.MouseEvent) => {
    event.preventDefault();
    showMenu(
      event.clientX,
      event.clientY,
      <Menu>
        <MenuItem icon={IconSet.EDIT} text="Rename" onClick={startRenaming} />
        <MenuItem
          icon={IconSet.CLOSE}
          text="Close tab"
          onClick={() => uiStore.closeWorkspaceTab(workspace)}
          disabled={!uiStore.workspaceTabs.includes(workspace)}
        />
        <MenuDivider />
        <MenuItem
          icon={IconSet.DELETE}
          text="Delete workspace…"
          onClick={() => uiStore.askToDeleteWorkspace(workspace)}
        />
      </Menu>,
    );
  };
}

/**
 * Asked before making a workspace of many images, or adding many to one by dropping them: preparing
 * them takes a while
 */
const LargeWorkspaceAlert = observer(() => {
  const { workspaceStore } = useStore();
  const request = workspaceStore.largeWorkspaceRequest;
  if (request === undefined) {
    return null;
  }
  const count = request.imageCount.toLocaleString();
  const { adding } = request;
  return (
    <Alert
      open
      title={
        adding !== undefined
          ? `Add ${count} images of ${adding.label} to ${adding.workspaceName}?`
          : `Make a workspace of ${count} images?`
      }
      icon={IconSet.INFO}
      type="info"
      primaryButtonText={adding !== undefined ? 'Add them' : 'Make it'}
      defaultButton={DialogButton.PrimaryButton}
      onClick={(button) =>
        button === DialogButton.PrimaryButton
          ? workspaceStore.confirmLargeWorkspace()
          : workspaceStore.cancelLargeWorkspace()
      }
    >
      <p>
        Getting this many images ready to be shown takes a while. Atlas does it in the background,
        and shows how far it got at the bottom left.
      </p>
      {adding === undefined && (
        <p>
          Its tab is there right away, and you can keep using the Library. Opened before it is
          ready, it shows the images that are done and how many are still to come.
        </p>
      )}
      <p>Up close, every image is drawn at its full resolution as you look at it.</p>
    </Alert>
  );
});

interface WorkspaceTabProps {
  workspace: ClientWorkspace;
  isActive: boolean;
}

const WorkspaceTab = observer(({ workspace, isActive }: WorkspaceTabProps) => {
  const { uiStore, workspaceStore } = useStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const { mark, props: dnd } = useWorkspaceDrop(workspace, 'horizontal', !isRenaming);
  const isPreparing = workspaceStore.imagesOf(workspace)?.isPreparing === true;
  const showMenu = useWorkspaceMenu(workspace, () => setIsRenaming(true));

  return (
    <div
      role="tab"
      className="workspace-tab"
      aria-selected={isActive}
      data-drop={mark}
      tabIndex={0}
      onClick={() => uiStore.openWorkspace(workspace)}
      onDoubleClick={() => setIsRenaming(true)}
      // A click of the wheel closes it, as in a browser (pressing it would start scrolling)
      onMouseDown={(event) => event.button === 1 && event.preventDefault()}
      onAuxClick={(event) => event.button === 1 && uiStore.closeWorkspaceTab(workspace)}
      onContextMenu={showMenu}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          setIsRenaming(true);
        }
      }}
      {...dnd}
      data-tooltip={
        isRenaming
          ? undefined
          : isPreparing
          ? 'Its images are being prepared'
          : `${workspace.name}: double click to rename, drag to move`
      }
    >
      {isPreparing ? <span className="workspace-spinner small" /> : IconSet.WORKSPACE}
      {isRenaming ? (
        <WorkspaceNameInput
          workspace={workspace}
          className="workspace-tab-name"
          onDone={() => setIsRenaming(false)}
        />
      ) : (
        <span className="workspace-tab-name">{workspace.name}</span>
      )}
      <button
        className="workspace-tab-close btn-icon"
        aria-label={`Close the tab of ${workspace.name}`}
        data-tooltip="Close the tab; the workspace stays in the side panel"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          uiStore.closeWorkspaceTab(workspace);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {IconSet.CLOSE}
      </button>
    </div>
  );
});

export default WorkspaceTabs;

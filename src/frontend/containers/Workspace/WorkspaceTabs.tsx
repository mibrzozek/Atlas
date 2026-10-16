import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';

import { IconSet } from 'widgets';
import { Alert, DialogButton } from 'widgets/popovers';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import { useWorkspaceDrop } from './useWorkspaceDrop';
import { WorkspaceNameInput } from './WorkspaceNameInput';

/**
 * The Library and the workspaces, as tabs in the top bar, and a + that makes a workspace of the images
 * the Library shows. Opening one changes nothing else in the window.
 */
const WorkspaceTabs = observer(() => {
  const { uiStore, workspaceStore } = useStore();
  const active = uiStore.activeWorkspace;
  const [deleting, setDeleting] = useState<ClientWorkspace>();

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Library and workspaces">
      <button
        role="tab"
        className="workspace-tab"
        aria-selected={active === undefined}
        onClick={uiStore.openLibrary}
        data-tooltip="Your images"
      >
        {IconSet.MEDIA}
        <span className="workspace-tab-name">Library</span>
      </button>
      {workspaceStore.workspaceList.map((workspace) => (
        <WorkspaceTab
          key={workspace.id}
          workspace={workspace}
          isActive={workspace === active}
          onDelete={() => setDeleting(workspace)}
        />
      ))}
      <button
        className="workspace-tab-add btn-icon"
        onClick={workspaceStore.createFromLibrary}
        aria-label="New workspace"
        data-tooltip="New workspace with the images the Library shows"
      >
        {IconSet.PLUS}
      </button>
      {deleting !== undefined && (
        <Alert
          open
          title={`Delete the workspace "${deleting.name}"?`}
          icon={IconSet.WARNING}
          type="warning"
          primaryButtonText="Delete"
          defaultButton={DialogButton.CloseButton}
          onClick={(button) => {
            if (button === DialogButton.PrimaryButton) {
              workspaceStore.remove(deleting);
            }
            setDeleting(undefined);
          }}
        >
          <p>How its images are arranged is lost. The images themselves stay in your library.</p>
        </Alert>
      )}
      <LargeWorkspaceAlert />
    </div>
  );
});

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
  onDelete: () => void;
}

const WorkspaceTab = observer(({ workspace, isActive, onDelete }: WorkspaceTabProps) => {
  const { uiStore, workspaceStore } = useStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const { mark, props: dnd } = useWorkspaceDrop(workspace, 'horizontal', !isRenaming);
  const isPreparing = workspaceStore.imagesOf(workspace)?.isPreparing === true;

  return (
    <div
      role="tab"
      className="workspace-tab"
      aria-selected={isActive}
      data-drop={mark}
      tabIndex={0}
      onClick={() => uiStore.openWorkspace(workspace)}
      onDoubleClick={() => setIsRenaming(true)}
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
          : 'Double click to rename, drag to move'
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
      {/* Only on the open tab: on the others it would leave a gap where it is hidden */}
      {isActive && (
        <button
          className="workspace-tab-close btn-icon"
          aria-label={`Delete the workspace ${workspace.name}`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          {IconSet.CLOSE}
        </button>
      )}
    </div>
  );
});

export default WorkspaceTabs;

import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';

import { IconSet } from 'widgets';
import { Alert, DialogButton } from 'widgets/popovers';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';

/** Marks a drag of a workspace tab to another place among the tabs */
const TAB_DND_TYPE = 'application/x-atlas-workspace-tab';

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

/** Asked before making a workspace of many images: preparing them takes a while */
const LargeWorkspaceAlert = observer(() => {
  const { workspaceStore } = useStore();
  const request = workspaceStore.largeWorkspaceRequest;
  if (request === undefined) {
    return null;
  }
  return (
    <Alert
      open
      title={`Make a workspace of ${request.imageCount.toLocaleString()} images?`}
      icon={IconSet.INFO}
      type="info"
      primaryButtonText="Make it"
      defaultButton={DialogButton.PrimaryButton}
      onClick={(button) =>
        button === DialogButton.PrimaryButton
          ? workspaceStore.confirmLargeWorkspace()
          : workspaceStore.cancelLargeWorkspace()
      }
    >
      <p>
        Getting this many images ready to be shown takes a while. Atlas does it in the background:
        you can keep using the Library, and see how far it got at the foot of the side panel.
      </p>
      <p>
        Its tab is there right away. Opened before it is ready, it shows the images that are done
        and how many are still to come. Up close, every image is drawn at its full resolution as you
        look at it.
      </p>
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
  const [dropSide, setDropSide] = useState<'before' | 'after'>();
  const isPreparing = workspaceStore.imagesOf(workspace)?.isPreparing === true;

  const sideOf = (event: React.DragEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  };

  return (
    <div
      role="tab"
      className="workspace-tab"
      aria-selected={isActive}
      data-drop={dropSide}
      tabIndex={0}
      onClick={() => uiStore.openWorkspace(workspace)}
      onDoubleClick={() => setIsRenaming(true)}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          setIsRenaming(true);
        }
      }}
      draggable={!isRenaming}
      onDragStart={(event) => {
        event.dataTransfer.setData(TAB_DND_TYPE, workspace.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(TAB_DND_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropSide(sideOf(event));
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropSide(undefined);
        }
      }}
      onDrop={(event) => {
        setDropSide(undefined);
        const dragged = workspaceStore.workspaceList.find(
          (w) => w.id === event.dataTransfer.getData(TAB_DND_TYPE),
        );
        if (dragged !== undefined && dragged !== workspace) {
          event.preventDefault();
          const others = workspaceStore.workspaceList.filter((w) => w !== dragged);
          const index = others.indexOf(workspace) + (sideOf(event) === 'before' ? 0 : 1);
          workspaceStore.move(dragged, index);
        }
      }}
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
        <input
          className="workspace-tab-name"
          autoFocus
          defaultValue={workspace.name}
          aria-label="Name of the workspace"
          onFocus={(event) => event.target.select()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              workspace.rename(event.currentTarget.value);
              setIsRenaming(false);
            } else if (event.key === 'Escape') {
              setIsRenaming(false);
            }
          }}
          onBlur={(event) => {
            workspace.rename(event.currentTarget.value);
            setIsRenaming(false);
          }}
        />
      ) : (
        <span className="workspace-tab-name">{workspace.name}</span>
      )}
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
    </div>
  );
});

export default WorkspaceTabs;

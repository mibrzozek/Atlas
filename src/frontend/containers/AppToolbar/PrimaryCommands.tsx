import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet, keyComboToString } from 'widgets';
import { ToolbarButton } from 'widgets/toolbar';
import { FileRemoval } from '../../components/RemovalAlert';
import FileTagEditor from '../../containers/AppToolbar/FileTagEditor';
import { useStore } from '../../contexts/StoreContext';
import { SortCommand, ViewCommand } from './Menus';
import Searchbar from './Searchbar';

export const OutlinerToggle = observer(() => {
  const { uiStore } = useStore();

  return (
    <ToolbarButton
      id="outliner-toggle"
      text="Toggle Outliner"
      icon={uiStore.isOutlinerOpen ? IconSet.DOUBLE_CARET : IconSet.MENU_HAMBURGER}
      controls="outliner"
      pressed={uiStore.isOutlinerOpen}
      onClick={uiStore.toggleOutliner}
      tabIndex={0}
    />
  );
});

const PrimaryCommands = observer(() => {
  const { fileStore } = useStore();

  return (
    <>
      <OutlinerToggle />
      <FileSelectionCommand />
      <TagOverlayToggle />

      <Searchbar />

      {/* TODO: Put back tag button (or just the T hotkey) */}
      {fileStore.showsMissingContent ? (
        // Only show option to remove selected files in toolbar when viewing missing files */}
        <RemoveFilesPopover />
      ) : (
        // Only show when not viewing missing files (so it is replaced by the Delete button)
        <FileTagEditor />
      )}

      <CollageCommands />

      <ShuffleCommand />

      <SortCommand />

      <ViewCommand />
    </>
  );
});

export default PrimaryCommands;

/** A new random order of the images that are shown, with every click */
export const ShuffleCommand = observer(() => {
  const { fileStore, uiStore } = useStore();
  return (
    <ToolbarButton
      icon={IconSet.SHUFFLE}
      text="Shuffle"
      onClick={fileStore.shuffle}
      pressed={fileStore.orderBy === 'random' && !fileStore.isCollageMode}
      tooltip={`Random order (${keyComboToString(uiStore.hotkeyMap.shuffle)})`}
    />
  );
});

/**
 * Collage mode: the images are in an order made by hand, and can be dragged to another place.
 * While it is on, two selected images can be switched.
 */
export const CollageCommands = observer(() => {
  const { fileStore, uiStore } = useStore();
  const { isCollageMode, canReorderCollage } = fileStore;
  const selection = uiStore.fileSelection;

  const shortcut = keyComboToString(uiStore.hotkeyMap.switchCollageImages);

  return (
    <>
      {isCollageMode && (
        <ToolbarButton
          icon={IconSet.REPLACE}
          text="Switch"
          onClick={fileStore.swapSelectedFilesInCollage}
          disabled={!canReorderCollage || selection.size !== 2}
          tooltip={
            selection.size === 2
              ? `Switch the two selected images (${shortcut})`
              : `Select two images to switch them (${shortcut})`
          }
        />
      )}
      <ToolbarButton
        icon={IconSet.COLLAGE}
        text="Collage"
        onClick={fileStore.toggleCollageMode}
        pressed={isCollageMode}
        tooltip={
          isCollageMode
            ? 'Collage mode is on: drag images to move them'
            : 'Collage mode: drag images into your own order'
        }
      />
    </>
  );
});

export const SlideModeCommand = observer(() => {
  const { uiStore } = useStore();
  return (
    <>
      <ToolbarButton
        isCollapsible={false}
        icon={IconSet.ARROW_LEFT}
        onClick={uiStore.disableSlideMode}
        text="Back"
        tooltip="Back to content panel"
      />

      <div className="spacer" />

      <FileTagEditor />

      <ToolbarButton
        icon={IconSet.INFO}
        onClick={uiStore.toggleInspector}
        checked={uiStore.isInspectorOpen}
        text="Toggle the inspector panel"
        tooltip="Toggle the inspector panel"
      />
    </>
  );
});

const FileSelectionCommand = observer(() => {
  const { uiStore, fileStore } = useStore();
  const selectionCount = uiStore.fileSelection.size;
  const fileCount = fileStore.fileList.length;

  const allFilesSelected = fileCount > 0 && selectionCount === fileCount;
  // If everything is selected, deselect all. Else, select all
  const handleToggleSelect = () => {
    selectionCount === fileCount ? uiStore.clearFileSelection() : uiStore.selectAllFiles();
  };

  return (
    <ToolbarButton
      isCollapsible={false}
      icon={allFilesSelected ? IconSet.SELECT_ALL_CHECKED : IconSet.SELECT_ALL}
      onClick={handleToggleSelect}
      pressed={allFilesSelected}
      text={selectionCount}
      tooltip="Selects or deselects all images"
      disabled={fileCount === 0}
    />
  );
});

const TagOverlayToggle = observer(() => {
  const { uiStore } = useStore();
  const isEnabled = uiStore.isThumbnailTagOverlayEnabled;

  return (
    <ToolbarButton
      icon={isEnabled ? IconSet.TAG : IconSet.TAG_BLANCO}
      onClick={uiStore.toggleThumbnailTagOverlay}
      pressed={isEnabled}
      text="Tags on images"
      tooltip="Shows or hides the tags on the images"
    />
  );
});

const RemoveFilesPopover = observer(() => {
  const { uiStore } = useStore();
  return (
    <>
      <ToolbarButton
        icon={IconSet.DELETE}
        disabled={uiStore.fileSelection.size === 0}
        onClick={uiStore.openToolbarFileRemover}
        text="Delete"
        tooltip="Delete selected missing images from library"
      />
      <FileRemoval />
    </>
  );
});

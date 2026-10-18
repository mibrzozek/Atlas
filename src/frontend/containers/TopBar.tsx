import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { ContextMenuLayer } from 'widgets/menus';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../contexts/StoreContext';
import { SortCommand, ViewCommand } from './AppToolbar/Menus';
import { CollageCommands, OutlinerToggle, ShuffleCommand } from './AppToolbar/PrimaryCommands';
import SecondaryCommands from './AppToolbar/SecondaryCommands';
import WorkspaceTabs from './Workspace/WorkspaceTabs';
import WorkspaceTools from './Workspace/WorkspaceTools';

/**
 * The bar across the top of the window, above the outliner and the gallery
 */
const TopBar = observer(() => {
  const { uiStore } = useStore();
  // While one image is open the bar is shown anyway, with what belongs to that image
  const isBarHidden = !uiStore.isSearchBarVisible && !uiStore.isSlideMode;

  return (
    // Its own layer for right-click menus (of the workspace tabs): the one in Main does not reach up here
    <ContextMenuLayer>
      <Toolbar id="top-bar" label="Navigation" controls="layout-container" isCompact>
        {/* The button for the side panel is in the bar that is hidden */}
        {isBarHidden && <OutlinerToggle />}
        <ToolbarButton
          icon={IconSet.HOME}
          text="Home"
          tooltip="Go to your home gallery"
          onClick={uiStore.viewHomeGallery}
          pressed={uiStore.isHomeGallery}
          tabIndex={0}
        />
        <ToolbarButton
          icon={IconSet.ADD_BOLD}
          text="Create folders"
          tooltip="Create folders"
          onClick={uiStore.openFolderCreator}
          pressed={uiStore.isFolderCreatorOpen}
        />
        <ToolbarButton
          icon={IconSet.TAG_GROUP}
          text="Tags"
          tooltip="Edit tags and collections"
          onClick={uiStore.openTagManager}
          pressed={uiStore.isTagManagerOpen}
        />

        <WorkspaceTabs />

        <div className="spacer" />

        {/* While the bar above the gallery is hidden, what changes how the gallery looks moves up here */}
        {isBarHidden && uiStore.activeWorkspace !== undefined && <WorkspaceTools />}
        {isBarHidden && uiStore.activeWorkspace === undefined && (
          <>
            <CollageCommands />
            <ShuffleCommand />
            <SortCommand />
            <ViewCommand />
          </>
        )}
        <ToolbarButton
          icon={IconSet.ARROW_DOWN}
          text="Search bar"
          tooltip={
            uiStore.isSearchBarVisible
              ? 'Hide the bar with the search and the tags'
              : 'Show the bar with the search and the tags'
          }
          onClick={uiStore.toggleSearchBar}
          pressed={uiStore.isSearchBarVisible}
        />
        {/* Settings, help and the rest of the menu */}
        <SecondaryCommands />
      </Toolbar>
    </ContextMenuLayer>
  );
});

export default TopBar;

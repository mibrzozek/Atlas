import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../contexts/StoreContext';

/**
 * The bar across the top of the window, above the outliner and the gallery
 */
const TopBar = observer(() => {
  const { uiStore } = useStore();

  return (
    <Toolbar id="top-bar" label="Navigation" controls="layout-container" isCompact>
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
        tooltip="Create numbered folders"
        onClick={uiStore.openFolderCreator}
        pressed={uiStore.isFolderCreatorOpen}
      />
    </Toolbar>
  );
});

export default TopBar;

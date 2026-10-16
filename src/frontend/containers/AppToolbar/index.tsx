import { observer } from 'mobx-react-lite';
import React from 'react';

import { Toolbar } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';
import WorkspaceTools from '../Workspace/WorkspaceTools';
import PrimaryCommands, { OutlinerToggle, SlideModeCommand } from './PrimaryCommands';

/**
 * The top-level app toolbar
 */
const AppToolbar = observer(() => {
  const { uiStore } = useStore();

  return (
    <Toolbar id="toolbar" label="App Toolbar" controls="layout-container" isCompact>
      {/* Primary Commands depending on current mode */}
      {uiStore.activeWorkspace !== undefined ? (
        <>
          <OutlinerToggle />
          <div className="spacer" />
          <WorkspaceTools />
        </>
      ) : uiStore.isSlideMode ? (
        <SlideModeCommand />
      ) : (
        <PrimaryCommands />
      )}
    </Toolbar>
  );
});

export default AppToolbar;

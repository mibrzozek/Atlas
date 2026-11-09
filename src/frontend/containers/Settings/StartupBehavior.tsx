import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
import { RendererMessenger } from 'src/ipc/renderer';
import { Toggle } from 'widgets';
import { useStore } from '../../contexts/StoreContext';

export const StartupBehavior = observer(() => {
  const { uiStore } = useStore();

  const [isAutoUpdateEnabled, setAutoUpdateEnabled] = useState(
    RendererMessenger.isCheckUpdatesOnStartupEnabled,
  );

  const toggleAutoUpdate = useCallback(() => {
    RendererMessenger.toggleCheckUpdatesOnStartup();
    setAutoUpdateEnabled((isOn) => !isOn);
  }, []);

  return (
    <div className="vstack">
      <Toggle checked={uiStore.isStartupIntroEnabled} onChange={uiStore.toggleStartupIntro}>
        Show Atlas Logo splash screen
      </Toggle>
      <Toggle checked={uiStore.isLogoThemed} onChange={uiStore.toggleLogoThemed}>
        Themed logo
      </Toggle>
      <Toggle checked={isAutoUpdateEnabled} onChange={toggleAutoUpdate}>
        Check for updates
      </Toggle>
    </div>
  );
});

import { observer } from 'mobx-react-lite';
import React from 'react';

import { SCREENSAVER_LIMITS } from 'common/screensaver';
import { Button, IconSet, Toggle } from 'widgets';
import { Callout } from 'widgets/notifications';
import { useStore } from '../../contexts/StoreContext';

export const Screensaver = observer(() => {
  const { uiStore, tagStore } = useStore();
  const homeTagName = tagStore.homeTag?.name ?? 'Home';

  const handlePreview = () => {
    // The settings are a window of their own, which would stay in front of the screensaver
    uiStore.closeSettings();
    uiStore.startScreensaver();
  };

  return (
    <div id="screensaver-settings" className="vstack">
      <Callout icon={IconSet.INFO}>
        When you have not used your computer for a while and Atlas is the window in front, it fills
        the screen with the images of your home gallery (the images tagged <b>{homeTagName}</b>).
        They are laid out like the masonry view you use, in rows or in columns, and slowly move
        through the screen. Moving the mouse or pressing a key brings you back.
      </Callout>

      <Toggle checked={uiStore.isScreensaverEnabled} onChange={uiStore.toggleScreensaver}>
        Start the screensaver when the computer is not used
      </Toggle>

      <label>
        Start after
        <input
          type="number"
          min={SCREENSAVER_LIMITS.idleMinutes.min}
          max={SCREENSAVER_LIMITS.idleMinutes.max}
          step={1}
          value={uiStore.screensaverIdleMinutes}
          disabled={!uiStore.isScreensaverEnabled}
          onChange={(e) => uiStore.setScreensaverIdleMinutes(e.target.valueAsNumber)}
        />
        minutes without using the mouse or keyboard
      </label>

      <label>
        Move to the next image every
        <input
          type="number"
          min={SCREENSAVER_LIMITS.secondsPerImage.min}
          max={SCREENSAVER_LIMITS.secondsPerImage.max}
          step={1}
          value={uiStore.screensaverSecondsPerImage}
          onChange={(e) => uiStore.setScreensaverSecondsPerImage(e.target.valueAsNumber)}
        />
        seconds
      </label>

      <div>
        <Button text="Start it now" onClick={handlePreview} styling="outlined" />
      </div>
    </div>
  );
});

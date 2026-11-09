import { observer } from 'mobx-react-lite';
import React from 'react';

import { AtlasMark, AtlasWordmark } from '../../components/AtlasLogo';
import { useStore } from '../../contexts/StoreContext';

/**
 * At the start, over the home gallery while it is still unseen: the logo, then the name fading in, then both
 * fading out as the images fade in. Timed in `startup.scss`; turned off in Settings, Start-up
 */
const StartupIntro = observer(() => {
  const { uiStore } = useStore();
  const phase = uiStore.startupPhase;
  // Still there while the images fade in: it is fading out itself
  if (!uiStore.isStartupIntroEnabled || (phase !== 'intro' && phase !== 'reveal')) {
    return null;
  }
  return (
    <div className="startup-intro" aria-hidden>
      <AtlasMark className="startup-intro-mark" />
      <div className="startup-intro-name">
        <AtlasWordmark />
      </div>
    </div>
  );
});

export default StartupIntro;

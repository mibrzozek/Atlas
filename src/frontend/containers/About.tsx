import { observer } from 'mobx-react-lite';
import React from 'react';
import PopupWindow from '../components/PopupWindow';
import { useStore } from '../contexts/StoreContext';

import Logo_About from 'resources/logo/atlas/atlas-about-dark.jpg';
import { RendererMessenger } from 'src/ipc/renderer';
import ExternalLink from '../components/ExternalLink';

const ATLAS_REPOSITORY = 'https://github.com/mibrzozek/Atlas';

const About = observer(() => {
  const { uiStore } = useStore();

  if (!uiStore.isAboutOpen) {
    return null;
  }
  return (
    <PopupWindow onClose={uiStore.closeAbout} windowName="about" closeOnEscape>
      <div id="about" className="light">
        <img src={Logo_About} alt="Logo" />
        <small>
          Version <strong>{RendererMessenger.getVersion()}</strong>
        </small>
        <p>
          Atlas is a place to browse, tag and arrange your photographs, digital and film. It only
          reads your image folders: tags, collections and the order you put things in are kept by
          Atlas, and your files are never changed.
        </p>
        <p>
          It is <b>free and open source</b> (GPL-3.0). The source code, and the place to report a
          problem, is
        </p>
        <ExternalLink url={ATLAS_REPOSITORY}>github.com/mibrzozek/Atlas</ExternalLink>
        <p>
          Atlas began as, and is a fork of, <b>Allusion</b>: the visual library manager made by a
          small team who gathered around a common interest in art, design and software. Everything
          here is built on their work.
        </p>
        <span>
          <ExternalLink url="https://allusion-app.github.io/">allusion-app.github.io</ExternalLink>
          {' · '}
          <ExternalLink url="https://github.com/allusion-app/Allusion">
            github.com/allusion-app/Allusion
          </ExternalLink>
        </span>
      </div>
    </PopupWindow>
  );
});

export default About;

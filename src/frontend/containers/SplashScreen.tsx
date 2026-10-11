import React from 'react';

import AtlasMark from 'resources/logo/atlas/atlas-mark.svg';
import { SVG } from 'widgets/icons';
import AtlasWordmark from '../components/AtlasWordmark';

const SplashScreen = () => {
  // Using inline style since css file might not have been loaded
  const splashScreenContainerStyles: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
  };

  const splashScreenStyles: React.CSSProperties = {
    position: 'relative',
    top: '25%',
    margin: 'auto',
    width: '200p',
    textAlign: 'center',
    color: '#f5f8fa',
  };

  const textStyles: React.CSSProperties = {
    margin: '24px 0 0 0',
    fontFamily:
      '-apple-system, "BlinkMacSystemFont", "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", \
    "Open Sans", "Helvetica Neue", "Icons16", sans-serif',
    WebkitFontSmoothing: 'antialiased',
  };

  return (
    <div style={splashScreenContainerStyles} id="splash-screen">
      <div style={splashScreenStyles}>
        <svg style={{ width: 0 }}>
          {/* <defs>
            <linearGradient id="yellow-blue" x2="1" y2="1">
              <stop offset="0%" stopColor="#F7EA3A" stopOpacity="1">
                <animate
                  attributeName="stop-color"
                  values="#F7EA3A;#009DE0;#F7EA3A;#009DE0;#F7EA3A;#009DE0"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </stop>
              <stop offset="100%" stopColor="#009DE0" stopOpacity="1">
                <animate
                  attributeName="stop-color"
                  values="#F7EA3A;#009DE0;#F7EA3A;#009DE0;#F7EA3A;#009DE0"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="offset"
                  values=".95;.80;.60;.40;.20;0;.20;.40;.60;.80;.95"
                  dur="2s"
                />
              </stop>
            </linearGradient>
          </defs> */}
        </svg>

        <SVG src={AtlasMark} style={{ width: '144px', height: '144px' }} />

        <div style={textStyles}>
          <AtlasWordmark />
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

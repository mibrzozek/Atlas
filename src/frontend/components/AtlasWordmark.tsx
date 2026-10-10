import React from 'react';

// Inline styles: also used on the splash screen, where the stylesheet might not have been loaded yet
const LETTER_SPACING = '0.08em';

const smallLine: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  fontWeight: 400,
  letterSpacing: '0.28em',
  textTransform: 'uppercase',
  opacity: 0.7,
};

const logoLine: React.CSSProperties = {
  margin: '0 0 0.1em 0',
  // Compensates for the spacing after the last letter, so that the word is optically centered
  paddingLeft: LETTER_SPACING,
  fontFamily: '"Segoe UI Black", "Arial Black", "Helvetica Neue", Impact, sans-serif',
  fontSize: '124px',
  fontWeight: 900,
  lineHeight: 1,
  letterSpacing: LETTER_SPACING,
  backgroundImage: 'linear-gradient(120deg, #f7ea3a 0%, #7fc4a0 50%, #009de0 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
};

const AtlasWordmark = () => (
  <div role="heading" aria-level={1} aria-label="Atlas of my mind">
    <p style={logoLine}>ATLAS</p>
    <p style={smallLine}>of my mind</p>
  </div>
);

export default AtlasWordmark;

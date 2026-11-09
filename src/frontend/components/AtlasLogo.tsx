import { observer } from 'mobx-react-lite';
import React, { RefObject, useId, useLayoutEffect, useRef, useState } from 'react';

import { ORIGINAL_LOGO, keepsOwnColoursOn, parseColour } from 'common/logo-colours';
import { useStore } from '../contexts/StoreContext';

/**
 * The Atlas logo in its own colours wherever they stand out from the theme's background (the dark themes),
 * otherwise in the theme's (`atlas-logo.scss`): the mark shades from the accent colour to the strongest text
 * colour, the name is in that text colour. The app's icon is `resources/logo/atlas/`
 */
export const AtlasMark = observer(({ className = '' }: { className?: string }) => {
  const gradient = useId();
  const svg = useRef<SVGSVGElement>(null);
  const isOwn = useOwnColours(svg);
  const [from, middle, to] = ORIGINAL_LOGO.mark;
  return (
    <svg ref={svg} className={`atlas-mark ${className}`} viewBox="0 0 16 16" aria-hidden>
      <defs>
        <linearGradient
          id={gradient}
          x1="2.59"
          y1="13.41"
          x2="13.41"
          y2="2.59"
          gradientUnits="userSpaceOnUse"
        >
          {isOwn ? (
            <>
              <stop offset="0" stopColor={from} />
              <stop offset="0.5" stopColor={middle} />
              <stop offset="0.95" stopColor={to} />
            </>
          ) : (
            <>
              <stop offset="0" className="atlas-mark-from" />
              <stop offset="1" className="atlas-mark-to" />
            </>
          )}
        </linearGradient>
      </defs>
      <circle cx="8" cy="8" r="7.52" fill={`url(#${gradient})`} />
    </svg>
  );
});

const [nameFrom, nameMiddle, nameTo] = ORIGINAL_LOGO.name;
const OWN_NAME: React.CSSProperties = {
  backgroundImage: `linear-gradient(120deg, ${nameFrom} 0%, ${nameMiddle} 50%, ${nameTo} 100%)`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
};
const OWN_LINE: React.CSSProperties = { color: ORIGINAL_LOGO.line, opacity: 0.7 };

export const AtlasWordmark = observer(() => {
  const wordmark = useRef<HTMLDivElement>(null);
  const isOwn = useOwnColours(wordmark);
  return (
    <div
      ref={wordmark}
      className="atlas-wordmark"
      role="heading"
      aria-level={1}
      aria-label="Atlas of my mind"
    >
      <p className="atlas-wordmark-name" style={isOwn ? OWN_NAME : undefined}>
        Atlas
      </p>
      <p className="atlas-wordmark-line" style={isOwn ? OWN_LINE : undefined}>
        of my mind
      </p>
    </div>
  );
});

/**
 * Whether the logo keeps its own colours on what is drawn behind `element`, judged again when the theme
 * changes; never when the themed logo is asked for (Settings, Start-up)
 */
function useOwnColours(element: RefObject<Element>): boolean {
  const { uiStore } = useStore();
  const { theme, isLogoThemed } = uiStore;
  const [isOwn, setIsOwn] = useState(true);
  useLayoutEffect(() => {
    const background = backgroundBehind(element.current);
    setIsOwn(!isLogoThemed && background !== undefined && keepsOwnColoursOn(background));
  }, [element, theme, isLogoThemed]);
  return isOwn;
}

/** The colour of the first element around this one that paints a background */
function backgroundBehind(element: Element | null) {
  for (let e = element; e !== null; e = e.parentElement) {
    const colour = getComputedStyle(e).backgroundColor;
    if (colour !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(colour)) {
      return parseColour(colour);
    }
  }
  return undefined;
}

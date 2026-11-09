/**
 * The Atlas logo keeps its own colours wherever they stand out from the theme's background, and takes the
 * theme's colours only for the parts where they do not (`components/AtlasLogo.tsx`).
 */

export type Rgb = [number, number, number];

/** The logo's own colours: the mark and the name shade through these, the line is a light grey */
export const ORIGINAL_LOGO = {
  mark: ['#147df1', '#51b4cf', '#7af2a6'],
  name: ['#f7ea3a', '#7fc4a0', '#009de0'],
  line: '#f5f8fa',
} as const;

/**
 * Whether the logo keeps its own colours on this background: every one of them must stand out, by 3:1 for the
 * mark and the large name (WCAG, graphics and large text) and 4.5:1 for the small line. Otherwise the whole logo
 * takes the theme's colours. Measured: the dark themes keep them, the light ones (Gray not included) do not
 */
export function keepsOwnColoursOn(background: Rgb): boolean {
  const standsOut = (colours: readonly string[], least: number) =>
    colours.every((colour) => contrast(parseColour(colour)!, background) >= least);
  return (
    standsOut(ORIGINAL_LOGO.mark, 3) &&
    standsOut(ORIGINAL_LOGO.name, 3) &&
    standsOut([ORIGINAL_LOGO.line], 4.5)
  );
}

/** A colour as CSS writes it (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`), undefined for anything else */
export function parseColour(css: string): Rgb | undefined {
  const value = css.trim();
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  return undefined;
}

/** The contrast of two colours, from 1 to 21 (WCAG) */
export function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(colour: Rgb): number {
  const [r, g, b] = colour.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

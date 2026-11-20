import React from 'react';

import { FolderDateOrder } from 'common/folder-series';

/** Names by a pattern (a prefix, a number, a suffix) or by a date. Shared by the folder creator and a workspace */
export type NamingMode = 'pattern' | 'date';

/** The separators between the parts of a name and a date */
export const SEPARATORS: [value: string, label: string][] = [
  ['-', 'Dash  ( - )'],
  ['_', 'Underscore  ( _ )'],
  ['.', 'Period  ( . )'],
  [' ', 'Space'],
  ['', 'Nothing'],
];

/** The orders a date is written in; the labels show the order of today's date */
export const DATE_ORDERS: [value: FolderDateOrder, label: string][] = [
  ['YMD', 'Y M D'],
  ['yMD', 'YY M D'],
  ['DMY', 'D M Y'],
  ['MDY', 'M D Y'],
  ['YM', 'Y M'],
];

/** A labelled input. All fields in a row line up, whatever the length of their labels or the text size */
export const Field = (props: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="folder-creator-field" data-tooltip={props.hint}>
    <span>{props.label}</span>
    {props.children}
  </label>
);

/** A two-way switch: a track with a thumb that slides under the chosen option */
export const NamingModeSwitch = ({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: NamingMode;
  onChange: (mode: NamingMode) => void;
}) => (
  <div className="folder-creator-mode" role="radiogroup" aria-label={label} data-mode={mode}>
    <button
      type="button"
      role="radio"
      aria-checked={mode === 'pattern'}
      onClick={() => onChange('pattern')}
    >
      By pattern
    </button>
    <button
      type="button"
      role="radio"
      aria-checked={mode === 'date'}
      onClick={() => onChange('date')}
    >
      By date
    </button>
  </div>
);

/** How many digits a number is written with: 1,2,3 or 01,02,03 ..., and the style a naming already uses */
export const NumberStyleSelect = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  // 1, 2, 3 up to 000001, and whatever longer style is already in use
  const widths = [1, 2, 3, 4, 5, 6];
  const digits = parseInt(value, 10);
  if (digits > 6 && digits <= 15) {
    widths.push(digits);
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {widths.map((width) => (
        <option key={width} value={String(width)}>
          {[1, 2, 3].map((n) => String(n).padStart(width, '0')).join(', ')}
        </option>
      ))}
    </select>
  );
};

import React from 'react';

import { IconButton, IconSet } from 'widgets';
import useLocalStorage from '../hooks/useLocalStorage';

/**
 * Colors that belong to the theme. They are stored as the name of the theme's color, not as a fixed
 * color: a tag that has one changes along when another theme is picked.
 */
export const THEME_COLORS = [
  { name: 'Accent color of the theme', value: 'var(--accent-color)' },
  { name: 'Bright color of the theme', value: 'var(--text-color-strong)' },
  { name: 'Soft color of the theme', value: 'var(--text-color-muted)' },
];

const MAX_SAVED_COLORS = 16;
const isHexColor = (color: string) => /^#[0-9a-f]{6}$/i.test(color);

interface TagColorPickerProps {
  /** The color of the tag: empty for none */
  color: string;
  onPick: (color: string) => void;
}

/**
 * Picks the color of tags: no color, three colors of the theme, the colors that were kept,
 * and any other color. A color that was picked can be kept for next time.
 */
const TagColorPicker = ({ color, onPick }: TagColorPickerProps) => {
  const [savedColors, setSavedColors] = useLocalStorage<string[]>('tag-colors', []);
  const canSave = isHexColor(color) && !savedColors.includes(color.toLowerCase());

  const swatch = (value: string, tooltip: string, onRemove?: () => void) => (
    <button
      key={value}
      type="button"
      className="tag-color-swatch"
      style={{ background: value }}
      aria-label={tooltip}
      aria-pressed={color.toLowerCase() === value.toLowerCase()}
      data-tooltip={tooltip}
      onClick={() => onPick(value)}
      onContextMenu={
        onRemove &&
        ((event) => {
          event.preventDefault();
          onRemove();
        })
      }
    />
  );

  return (
    <div className="tag-color-picker" role="group" aria-label="Color">
      <button
        type="button"
        className="tag-color-swatch tag-color-none"
        aria-label="No color"
        aria-pressed={color === ''}
        data-tooltip="No color"
        onClick={() => onPick('')}
      />
      {THEME_COLORS.map(({ name, value }) => swatch(value, name))}
      {savedColors.length > 0 && <span className="tag-color-divider" />}
      {savedColors.map((saved) =>
        swatch(saved, `${saved}. Right-click to take it off this list`, () =>
          setSavedColors(savedColors.filter((c) => c !== saved)),
        ),
      )}
      <input
        type="color"
        className="tag-color-custom"
        aria-label="Any other color"
        data-tooltip="Pick any other color"
        value={isHexColor(color) ? color : '#808080'}
        onChange={(e) => onPick(e.target.value)}
      />
      {canSave && (
        <IconButton
          icon={IconSet.PLUS}
          className="tag-color-save"
          text="Keep this color in the list"
          onClick={() =>
            setSavedColors([...savedColors, color.toLowerCase()].slice(-MAX_SAVED_COLORS))
          }
        />
      )}
    </div>
  );
};

export default TagColorPicker;

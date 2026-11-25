import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';

import { ImageBorderMode, PAPER_COLOR, WorkspaceImageItem } from 'common/workspace';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import TagColorPicker from '../../components/TagColorPicker';
import { ClientWorkspace } from '../../entities/Workspace';

const BORDER_MODES: { mode: ImageBorderMode; name: string; detail: string }[] = [
  { mode: 'equal', name: 'Equal border', detail: 'Same width on all sides' },
  { mode: 'split', name: 'Split border', detail: 'Top & bottom and sides' },
];

const DEFAULT_BORDER_WIDTH = 16;
const SLIDER_MAX_WIDTH = 160;

interface ImageBorderDialogProps {
  workspace: ClientWorkspace;
  at?: { x: number; y: number };
  onClose: () => void;
}

/**
 * Adds, edits or removes a border on the selected photos of a workspace: equal on all four sides,
 * or split between top/bottom and left/right sides, in a chosen colour.
 */
export const ImageBorderDialog = observer(({ workspace, at, onClose }: ImageBorderDialogProps) => {
  const selectedImages = workspace.items
    .slice()
    .filter(
      (item): item is WorkspaceImageItem =>
        item.kind === 'image' && workspace.selection.has(item.id),
    );
  const existing = selectedImages.find((item) => item.border !== undefined)?.border;
  const hasExisting = existing !== undefined;

  const [mode, setMode] = useState<ImageBorderMode>(existing?.mode ?? 'equal');
  const [topBottom, setTopBottom] = useState<number>(
    existing ? Math.round(existing.topBottom) : DEFAULT_BORDER_WIDTH,
  );
  const [sides, setSides] = useState<number>(
    existing ? Math.round(existing.sides) : DEFAULT_BORDER_WIDTH,
  );
  const [color, setColor] = useState<string>(existing?.color ?? PAPER_COLOR);

  const selectMode = (nextMode: ImageBorderMode) => {
    if (nextMode === 'split' && mode === 'equal') {
      setSides(topBottom);
    }
    setMode(nextMode);
  };

  const apply = () => {
    const ids = new Set(selectedImages.map((item) => item.id));
    workspace.setImageBorder(ids, {
      mode,
      topBottom,
      sides: mode === 'equal' ? topBottom : sides,
      color,
    });
    onClose();
  };

  const remove = () => {
    const ids = new Set(selectedImages.map((item) => item.id));
    workspace.setImageBorder(ids, undefined);
    onClose();
  };

  const count = selectedImages.length;

  return (
    <Dialog
      open
      title="Photo border"
      icon={IconSet.BACKGROUND}
      isMovable
      placeAt={
        at !== undefined ? (size) => ({ left: at.x - size.width - 12, top: at.y - 24 }) : undefined
      }
      onCancel={onClose}
      describedby="image-border-info"
    >
      <form
        className="workspace-dialog"
        method="dialog"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            event.stopPropagation();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <p id="image-border-info">
          {count === 1
            ? 'Frame the selected photo.'
            : `Frame ${count.toLocaleString()} selected photos.`}
        </p>
        <div className="workspace-dialog-field">
          <span>Style</span>
          <div className="save-picture-formats" role="radiogroup" aria-label="Border style">
            {BORDER_MODES.map((option) => (
              <label key={option.mode} data-checked={mode === option.mode}>
                <input
                  type="radio"
                  name="border-mode"
                  value={option.mode}
                  checked={mode === option.mode}
                  onChange={() => selectMode(option.mode)}
                />
                <strong>{option.name}</strong>
                <small>{option.detail}</small>
              </label>
            ))}
          </div>
        </div>
        {mode === 'equal' ? (
          <BorderWidthRow
            label="Width"
            value={topBottom}
            onChange={(value) => {
              setTopBottom(value);
              setSides(value);
            }}
          />
        ) : (
          <>
            <BorderWidthRow label="Top & bottom" value={topBottom} onChange={setTopBottom} />
            <BorderWidthRow label="Sides" value={sides} onChange={setSides} />
          </>
        )}
        <div className="workspace-dialog-field">
          <span>Color</span>
          <TagColorPicker color={color} onPick={(picked) => setColor(picked || PAPER_COLOR)} />
        </div>
        <div className="dialog-actions">
          {hasExisting && (
            <span className="workspace-border-remove">
              <Button text="Remove border" styling="outlined" onClick={remove} />
            </span>
          )}
          <Button text="Cancel" onClick={onClose} />
          <Button text="Apply" styling="filled" onClick={apply} disabled={count === 0} />
        </div>
      </form>
    </Dialog>
  );
});

function BorderWidthRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="workspace-border-row">
      <span className="workspace-border-label">{label}</span>
      <input
        type="range"
        min={0}
        max={SLIDER_MAX_WIDTH}
        step={1}
        value={Math.min(value, SLIDER_MAX_WIDTH)}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <div className="workspace-dialog-input workspace-border-number">
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            onChange(Number.isFinite(next) ? Math.max(0, next) : 0);
          }}
        />
        <span>px</span>
      </div>
    </label>
  );
}

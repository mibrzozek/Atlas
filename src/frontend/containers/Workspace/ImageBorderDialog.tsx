import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  ImageBorder,
  ImageBorderMode,
  PAPER_COLOR,
  WorkspaceImageItem,
  WorkspaceItem,
} from 'common/workspace';
import { Button, IconSet } from 'widgets';
import TagColorPicker from '../../components/TagColorPicker';
import { ClientWorkspace } from '../../entities/Workspace';

const BORDER_MODES: { mode: ImageBorderMode; name: string }[] = [
  { mode: 'equal', name: 'Equal' },
  { mode: 'split', name: 'Split' },
];

const DEFAULT_BORDER_WIDTH = 16;
const SLIDER_MAX_WIDTH = 160;

interface ImageBorderDialogProps {
  workspace: ClientWorkspace;
  onClose: () => void;
}

/**
 * Compact floating panel tucked into the top right of the workspace for adding, editing or removing
 * borders on the selected photos in real time (one undoable session).
 */
export const ImageBorderDialog = observer(({ workspace, onClose }: ImageBorderDialogProps) => {
  // Snapshot of the workspace when the panel opened so live slider steps never drift and undo cleanly
  const sessionFrom = useRef<WorkspaceItem[]>(workspace.items.slice());
  const targetIds = useRef<Set<string>>(
    new Set(
      sessionFrom.current
        .filter((item) => item.kind === 'image' && workspace.selection.has(item.id))
        .map((item) => item.id),
    ),
  );
  const initialImages = sessionFrom.current.filter(
    (item): item is WorkspaceImageItem => item.kind === 'image' && targetIds.current.has(item.id),
  );
  const existing = initialImages.find((item) => item.border !== undefined)?.border;
  const didEdit = useRef(false);

  const [mode, setMode] = useState<ImageBorderMode>(existing?.mode ?? 'equal');
  const [topBottom, setTopBottom] = useState<number>(
    existing ? Math.round(existing.topBottom) : DEFAULT_BORDER_WIDTH,
  );
  const [sides, setSides] = useState<number>(
    existing ? Math.round(existing.sides) : DEFAULT_BORDER_WIDTH,
  );
  const [color, setColor] = useState<string>(existing?.color ?? PAPER_COLOR);

  const preview = useCallback(
    (next: ImageBorder | undefined) => {
      if (targetIds.current.size === 0) {
        return;
      }
      // If an external edit or Ctrl+Z ended our session while this floating panel stayed open,
      // start a fresh session from current items instead of clobbering intermediate changes
      if (didEdit.current && !workspace.isInSession(sessionFrom.current)) {
        sessionFrom.current = workspace.items.slice();
      }
      workspace.setImageBorder(targetIds.current, next, sessionFrom.current);
      if (workspace.isInSession(sessionFrom.current)) {
        didEdit.current = true;
      }
    },
    [workspace],
  );

  // Show the initial border right away when adding a new border
  useEffect(() => {
    if (existing === undefined && targetIds.current.size > 0) {
      preview({
        mode: 'equal',
        topBottom: DEFAULT_BORDER_WIDTH,
        sides: DEFAULT_BORDER_WIDTH,
        color: PAPER_COLOR,
      });
    }
    // Only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    if (didEdit.current && workspace.isInSession(sessionFrom.current)) {
      workspace.undo();
    }
    onClose();
  }, [workspace, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancel]);

  const update = (changes: {
    mode?: ImageBorderMode;
    topBottom?: number;
    sides?: number;
    color?: string;
  }) => {
    const nextMode = changes.mode ?? mode;
    const nextTopBottom = changes.topBottom ?? topBottom;
    const nextSides =
      changes.sides !== undefined
        ? changes.sides
        : nextMode === 'equal'
        ? nextTopBottom
        : changes.mode === 'split' && mode === 'equal'
        ? nextTopBottom
        : sides;
    const nextColor = changes.color ?? color;
    setMode(nextMode);
    setTopBottom(nextTopBottom);
    setSides(nextSides);
    setColor(nextColor);
    preview({
      mode: nextMode,
      topBottom: nextTopBottom,
      sides: nextMode === 'equal' ? nextTopBottom : nextSides,
      color: nextColor,
    });
  };

  const remove = () => {
    preview(undefined);
    onClose();
  };

  const count = targetIds.current.size;
  const hasBorderNow = workspace.items
    .slice()
    .some(
      (item) =>
        item.kind === 'image' && targetIds.current.has(item.id) && item.border !== undefined,
    );

  return (
    <section
      className="workspace-border-panel"
      role="dialog"
      aria-label="Photo border"
      data-surface-overlay
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onClose();
        }
        event.stopPropagation();
      }}
    >
      <header className="workspace-border-header">
        <span className="workspace-border-title">
          {IconSet.BACKGROUND}
          <span>Photo border</span>
          {count > 1 && <span className="workspace-border-count">{count.toLocaleString()}</span>}
        </span>
        <button
          type="button"
          className="btn-icon"
          aria-label="Close"
          data-tooltip="Cancel (Esc)"
          onClick={cancel}
        >
          {IconSet.CLOSE}
        </button>
      </header>

      <div className="workspace-border-toggle" role="group" aria-label="Border style">
        {BORDER_MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => update({ mode: option.mode })}
          >
            {option.name}
          </button>
        ))}
      </div>

      {mode === 'equal' ? (
        <BorderWidthRow
          label="Width"
          value={topBottom}
          onChange={(value) => update({ topBottom: value, sides: value })}
        />
      ) : (
        <>
          <BorderWidthRow
            label="Top & bottom"
            value={topBottom}
            onChange={(value) => update({ topBottom: value })}
          />
          <BorderWidthRow
            label="Sides"
            value={sides}
            onChange={(value) => update({ sides: value })}
          />
        </>
      )}

      <div className="workspace-border-color">
        <TagColorPicker
          color={color}
          onPick={(picked) => update({ color: picked || PAPER_COLOR })}
        />
      </div>

      <div className="workspace-border-actions">
        {hasBorderNow && (
          <span className="workspace-border-remove">
            <Button text="Remove" styling="outlined" onClick={remove} />
          </span>
        )}
        <Button text="Cancel" onClick={cancel} />
        <Button text="Done" styling="filled" onClick={onClose} />
      </div>
    </section>
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

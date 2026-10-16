import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { CropShape, LayoutKind, LAYOUT_GAP, suggestedCount, WorkspaceItem } from 'common/workspace';
import { IconSet } from 'widgets';
import { MenuButton, MenuRadioItem } from 'widgets/menus';
import { MenuDivider, MenuSliderItem } from 'widgets/menus/menu-items';
import { ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import { printWorkspace } from './printWorkspace';

const LAYOUTS: { kind: LayoutKind; text: string; icon: JSX.Element }[] = [
  { kind: 'rows', text: 'In rows', icon: IconSet.VIEW_MASONRY_H },
  { kind: 'columns', text: 'In columns', icon: IconSet.VIEW_MASONRY_V },
  { kind: 'grid', text: 'In a grid', icon: IconSet.VIEW_GRID },
];

const CROPS: { crop: CropShape | undefined; text: string }[] = [
  { crop: undefined, text: 'Whole images' },
  { crop: '1:1', text: 'Cut to squares (1:1)' },
  { crop: '4:5', text: 'Cut to portraits (4:5)' },
];

/** The most space between images the slider gives */
const MAX_GAP = 96;

/** The cut the selected images have now: the shape of their frames, when it is not the photo's */
function currentCrop(workspace: ClientWorkspace): CropShape | undefined {
  const image = workspace.items.find((i) => i.kind === 'image' && workspace.selection.has(i.id));
  if (image?.kind !== 'image') {
    return undefined;
  }
  const frame = image.width / image.height;
  if (Math.abs(frame - image.imageAspect) < 0.01) {
    return undefined;
  }
  return Math.abs(frame - 1) < 0.01 ? '1:1' : Math.abs(frame - 0.8) < 0.01 ? '4:5' : undefined;
}

/**
 * Lays out what is selected anew, like the views of the Library: in rows, in columns or in a grid, with as
 * many rows or columns as the slider says, as far apart as the other slider says, and in a grid whole or
 * cut to squares or portraits. Every change shows at once, and can be undone.
 */
const ArrangeMenu = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const count = workspace.selection.size;
  const [kind, setKind] = useState<LayoutKind>('grid');
  const [lines, setLines] = useState<number>();
  const [crop, setCrop] = useState<CropShape | undefined | 'unset'>('unset');
  const [gap, setGap] = useState(LAYOUT_GAP);
  const shownLines = Math.min(lines ?? suggestedCount(kind, count), Math.max(1, count));
  const shownCrop = crop === 'unset' ? currentCrop(workspace) : crop;
  // How things were when this session of arranging began, and what it last made of them: while the
  // workspace still shows that, a next step starts again from the same beginning
  const session = useRef<{
    from: WorkspaceItem[];
    made: readonly WorkspaceItem[];
    selection: string;
  }>();
  const frame = useRef<number>();
  useEffect(() => () => cancelAnimationFrame(frame.current!), []);

  const arrange = (changes: {
    kind?: LayoutKind;
    lines?: number;
    crop?: CropShape | undefined;
    gap?: number;
  }) => {
    const next = {
      kind: changes.kind ?? kind,
      lines: changes.lines ?? shownLines,
      crop: 'crop' in changes ? changes.crop : shownCrop,
      gap: changes.gap ?? gap,
    };
    setKind(next.kind);
    setLines(next.lines);
    setCrop(next.crop);
    setGap(next.gap);
    // A slider sends many values a second: one arrangement a frame, with the last of them
    cancelAnimationFrame(frame.current!);
    frame.current = requestAnimationFrame(() => {
      // One copy: compared item by item, the observable list would be checked for every item
      const items = workspace.items.slice();
      const selection = [...workspace.selection].sort().join();
      // The same session while the workspace still shows what it made, of the same selection; else
      // a new one from how things are now (another selection must not bring an older layout back)
      const isSameSession =
        session.current !== undefined &&
        session.current.selection === selection &&
        session.current.made.length === items.length &&
        session.current.made.every((item, i) => item === items[i]);
      const from = isSameSession ? session.current!.from : items;
      workspace.arrangeSelection(next.kind, next.lines, { gap: next.gap, crop: next.crop }, from);
      session.current = { from, made: workspace.items.slice(), selection };
    });
  };

  return (
    <MenuButton
      id="__workspace-arrange"
      menuID="__workspace-arrange-options"
      icon={IconSet.ARRANGE}
      text="Arrange"
      tooltip={
        count < 2
          ? 'Select two or more to arrange them in rows, columns or a grid'
          : 'Arrange what is selected in rows, columns or a grid'
      }
      disabled={count < 2 || workspace.isLocked}
      staysOpen
    >
      {LAYOUTS.map((layout) => (
        <MenuRadioItem
          key={layout.kind}
          icon={layout.icon}
          text={layout.text}
          checked={layout.kind === kind}
          onClick={() => arrange({ kind: layout.kind, lines: suggestedCount(layout.kind, count) })}
        />
      ))}
      <MenuDivider />
      {kind === 'grid' &&
        CROPS.map((option) => (
          <MenuRadioItem
            key={option.text}
            icon={IconSet.VIEW_GRID}
            text={option.text}
            checked={option.crop === shownCrop}
            onClick={() => arrange({ crop: option.crop })}
          />
        ))}
      {kind === 'grid' && <MenuDivider />}
      <MenuSliderItem
        id="workspace-arrange-lines"
        label={`${kind === 'rows' ? 'Rows' : 'Columns'}: ${shownLines}`}
        value={shownLines}
        min={1}
        max={Math.max(1, Math.min(count, 40))}
        step={1}
        options={[]}
        onChange={(value) => arrange({ lines: value })}
      />
      <MenuSliderItem
        id="workspace-arrange-gap"
        label={`Spacing: ${gap}`}
        value={gap}
        min={0}
        max={MAX_GAP}
        step={2}
        options={[]}
        onChange={(value) => arrange({ gap: value })}
      />
    </MenuButton>
  );
});

/** What the bar above the gallery holds while a workspace is open */
const WorkspaceTools = observer(() => {
  const { uiStore, workspaceStore } = useStore();
  const workspace = uiStore.activeWorkspace;
  return (
    <>
      {workspace !== undefined && <ArrangeMenu workspace={workspace} />}
      <ToolbarButton
        icon={IconSet.REPLACE}
        text="Swap"
        tooltip={
          workspace?.selection.size === 2
            ? 'Swap the two selected'
            : 'Select two to swap their places'
        }
        disabled={workspace === undefined || workspace.isLocked || workspace.selection.size !== 2}
        onClick={() => workspace?.swapSelection()}
      />
      <ToolbarButton
        icon={IconSet.BACKGROUND}
        text="Background"
        tooltip="Add a sheet of paper under what is selected, or in the middle"
        disabled={workspace?.isLocked}
        onClick={() => workspaceStore.surface?.addBackground()}
      />
      <ToolbarButton
        icon={IconSet.TEXT}
        text="Text"
        tooltip="Add a text (T)"
        disabled={workspace?.isLocked}
        onClick={() => {
          const id = workspaceStore.surface?.addText();
          if (id !== undefined) {
            uiStore.editWorkspaceText(id);
          }
        }}
      />
      {workspace !== undefined && (
        <ToolbarButton
          icon={workspace.isLocked ? IconSet.LOCK : IconSet.UNLOCK}
          text="Lock"
          tooltip={
            workspace.isLocked
              ? 'Locked: nothing moves, every drag pans (L)'
              : 'Lock everything in place (L)'
          }
          onClick={workspace.toggleLock}
          pressed={workspace.isLocked}
        />
      )}
      <ToolbarButton
        icon={IconSet.GRID}
        text="Grid"
        tooltip={uiStore.isWorkspaceGridShown ? 'Hide the grid (G)' : 'Show the grid (G)'}
        onClick={uiStore.toggleWorkspaceGrid}
        pressed={uiStore.isWorkspaceGridShown}
      />
      <ToolbarButton
        icon={IconSet.FIT}
        text="Fit everything"
        tooltip="Show everything on the workspace (F)"
        onClick={() => workspaceStore.surface?.fitEverything()}
      />
      <ToolbarButton
        icon={<span className="workspace-actual-size">1:1</span>}
        text="100%"
        tooltip="Zoom to 100%"
        onClick={() => workspaceStore.surface?.zoomToActualSize()}
      />
      <ToolbarButton
        icon={IconSet.PRINT}
        text="Print"
        tooltip="Print the selected sheet, or what is selected, or everything, at full resolution"
        disabled={workspace === undefined || workspace.items.length === 0}
        onClick={() => {
          const images = workspace && workspaceStore.imagesOf(workspace);
          const surface = document.querySelector<HTMLElement>('.workspace');
          if (workspace !== undefined && images !== undefined && surface !== null) {
            printWorkspace(workspace, images.sources, surface);
          }
        }}
      />
      <ToolbarButton
        icon={IconSet.LAYERS}
        text="Layers"
        tooltip={uiStore.isWorkspaceLayersOpen ? 'Fold the layers away' : 'Show the layers'}
        onClick={uiStore.toggleWorkspaceLayers}
        pressed={uiStore.isWorkspaceLayersOpen}
      />
    </>
  );
});

export default WorkspaceTools;

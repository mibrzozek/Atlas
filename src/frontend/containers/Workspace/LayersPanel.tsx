import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  LayerGroup,
  layerIndexOfDrop,
  layerRows,
  MIN_FONT_SIZE,
  PAPER_FORMATS,
  WorkspaceBackgroundItem,
  WorkspaceImageItem,
  WorkspaceItem,
  WorkspaceTextItem,
} from 'common/workspace';
import { IconSet, KeyCombo } from 'widgets';
import { Menu, MenuDivider, MenuItem, useContextMenu } from 'widgets/menus';
import TagColorPicker from '../../components/TagColorPicker';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import { ImageBorderDialog } from './ImageBorderDialog';
import { WorkspaceImages } from './WorkspaceImages';

/** The height of a row, in pixels: the list draws only the rows in sight, by this */
const ROW_HEIGHT = 24;
/** Rows drawn above and below what is in sight, for scrolling */
const SPARE_ROWS = 6;
/** Held within this many pixels of the top or bottom while dragging, the list scrolls by itself */
const SCROLL_EDGE = 32;
/** How long typing waits before the words are stored: not with every key */
const TYPING_DELAY = 250;
/** Marks a drag of layers within the panel */
const LAYERS_DND_TYPE = 'application/x-atlas-layers';

interface LayersPanelProps {
  workspace: ClientWorkspace;
  images: WorkspaceImages;
}

/**
 * Everything on the workspace, from the top layer down: a click selects, a drag up or down changes the
 * layer, a double click glides the camera to it. For a text that is selected, its words, size and colour.
 */
const LayersPanel = observer(({ workspace, images }: LayersPanelProps) => {
  const { uiStore } = useStore();
  const [borderSession, setBorderSession] = useState(0);
  const layers = workspace.layers;
  const { selection, isLocked } = workspace;
  const text = workspace.selectedText;
  const background = workspace.selectedBackground;

  useEffect(() => {
    if (isLocked) {
      setBorderSession(0);
    }
  }, [isLocked]);

  return (
    <aside className="workspace-layers" aria-label="Layers">
      <header>
        <span className="title">Layers</span>
        <span className="count">{layers.length.toLocaleString()}</span>
        <button
          className="btn-icon"
          onClick={uiStore.toggleWorkspaceLayers}
          aria-label="Fold the layers away"
          data-tooltip="Fold away into the button above"
        >
          {IconSet.ARROW_RIGHT}
        </button>
      </header>
      <LayerList
        workspace={workspace}
        images={images}
        layers={layers}
        onOpenBorder={() => setBorderSession((n) => n + 1)}
      />
      {borderSession > 0 && !isLocked && (
        <ImageBorderDialog
          key={borderSession}
          workspace={workspace}
          onClose={() => setBorderSession(0)}
        />
      )}
      {text !== undefined && <TextEditor key={text.id} workspace={workspace} text={text} />}
      {background !== undefined && (
        <BackgroundEditor workspace={workspace} background={background} />
      )}
      {isLocked && selection.size === 0 && (
        <p className="workspace-layers-note">Locked: unlock it to change the layers.</p>
      )}
    </aside>
  );
});

export default LayersPanel;

interface LayerListProps extends LayersPanelProps {
  layers: readonly WorkspaceItem[];
  onOpenBorder: () => void;
}

/**
 * The layers, of which only the rows in sight are drawn: a workspace can hold thousands of images. A group
 * of layers is a row of its own, with its layers under it when it is opened. A right click groups,
 * ungroups, locks and unlocks.
 */
const LayerList = observer(({ workspace, images, layers, onOpenBorder }: LayerListProps) => {
  const { uiStore, workspaceStore } = useStore();
  const showMenu = useContextMenu();
  const list = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  /** The groups that are opened, showing their layers */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** Where what is dragged would go: before the row with this number */
  const [dropAt, setDropAt] = useState<number>();
  const dragged = useRef<ReadonlySet<string>>();
  /** Active click-hold-drag paint across eye toggles: one undoable session */
  const paintHidden = useRef<{ target: boolean; from: WorkspaceItem[] }>();
  const rows = layerRows(layers, workspace.groupsInUse, expanded);

  useEffect(() => {
    const stopPaint = () => {
      paintHidden.current = undefined;
    };
    window.addEventListener('pointerup', stopPaint);
    window.addEventListener('pointercancel', stopPaint);
    window.addEventListener('blur', stopPaint);
    return () => {
      window.removeEventListener('pointerup', stopPaint);
      window.removeEventListener('pointercancel', stopPaint);
      window.removeEventListener('blur', stopPaint);
    };
  }, []);

  const startVisibilityPaint = (ids: string[], currentlyHidden: boolean) => {
    if (workspace.isLocked || ids.length === 0) {
      return;
    }
    const target = !currentlyHidden;
    const from = workspace.items.slice();
    paintHidden.current = { target, from };
    workspace.setItemsHidden(new Set(ids), target, from);
  };

  const continueVisibilityPaint = (ids: string[]) => {
    const paint = paintHidden.current;
    if (paint === undefined || workspace.isLocked || ids.length === 0) {
      return;
    }
    workspace.setItemsHidden(new Set(ids), paint.target, paint.from);
  };

  useLayoutEffect(() => {
    const element = list.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // What was selected on the surface comes into sight in the list: expand its group if needed
  // and scroll directly to the specific layer row
  // Not a copy of the selection: thousands can be selected, and this runs on every render
  const firstSelected: string | undefined = workspace.selection.values().next().value;
  useEffect(() => {
    if (firstSelected === undefined) {
      return;
    }
    const selectedItem = layers.find((item) => item.id === firstSelected);
    if (selectedItem?.groupId !== undefined && !expanded.has(selectedItem.groupId)) {
      const groupId = selectedItem.groupId;
      setExpanded((open) => (open.has(groupId) ? open : new Set([...open, groupId])));
    }
    // Only when another layer is selected, never when the user folds a group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSelected]);

  useEffect(() => {
    if (firstSelected === undefined) {
      return;
    }
    const element = list.current;
    const layerIdx = rows.findIndex((row) => row.kind === 'layer' && row.item.id === firstSelected);
    const index =
      layerIdx !== -1
        ? layerIdx
        : rows.findIndex(
            (row) => row.kind === 'group' && row.members.some((m) => m.id === firstSelected),
          );
    if (element !== null && index !== -1) {
      const top = index * ROW_HEIGHT;
      if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top - element.clientHeight / 2;
      }
    }
    // Re-run when selection changes or right after its group expands so the specific layer scrolls into sight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSelected, expanded]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - SPARE_ROWS);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + SPARE_ROWS);

  /** The place between two rows nearest to the pointer */
  const placeAt = (event: React.DragEvent) => {
    const rect = list.current!.getBoundingClientRect();
    const y = event.clientY - rect.top + list.current!.scrollTop;
    return Math.max(0, Math.min(rows.length, Math.round(y / ROW_HEIGHT)));
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(LAYERS_DND_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropAt(placeAt(event));
    // No wheel while dragging: near the edges, the list scrolls by itself
    const element = list.current!;
    const rect = element.getBoundingClientRect();
    if (event.clientY < rect.top + SCROLL_EDGE) {
      element.scrollTop -= ROW_HEIGHT / 2;
    } else if (event.clientY > rect.bottom - SCROLL_EDGE) {
      element.scrollTop += ROW_HEIGHT / 2;
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    const ids = dragged.current;
    const at = placeAt(event);
    setDropAt(undefined);
    if (ids === undefined) {
      return;
    }
    event.preventDefault();
    workspace.moveLayers(ids, layerIndexOfDrop(rows, at, ids, expanded, layers));
  };

  const startDrag = (event: React.DragEvent, ids: string[]) => {
    if (!ids.every((id) => workspace.selection.has(id))) {
      workspace.selectMany(ids, false);
    }
    dragged.current = new Set(workspace.selection);
    event.dataTransfer.setData(LAYERS_DND_TYPE, ids[0]);
    event.dataTransfer.effectAllowed = 'move';
  };
  const endDrag = () => {
    dragged.current = undefined;
    setDropAt(undefined);
  };

  const toggleExpanded = (groupId: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });

  const handleContextMenu = (event: React.MouseEvent) => {
    if (workspace.isLocked) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const groups = workspace.selectedGroups;
    const selectedImages = workspace.items
      .slice()
      .filter(
        (item): item is WorkspaceImageItem =>
          item.kind === 'image' && workspace.selection.has(item.id),
      );
    const hasImages = selectedImages.length > 0;
    const hasBorder = selectedImages.some((item) => item.border !== undefined);
    showMenu(
      event.clientX,
      event.clientY,
      <Menu>
        <MenuItem
          icon={IconSet.COPY}
          text="Duplicate"
          onClick={() => workspace.duplicateSelection()}
          disabled={workspace.selection.size === 0}
        />
        <MenuItem
          icon={IconSet.BACKGROUND}
          text={hasBorder ? 'Edit border…' : 'Add border…'}
          onClick={onOpenBorder}
          disabled={!hasImages}
        />
        <MenuDivider />
        <MenuItem
          icon={IconSet.LAYERS}
          text="Group layers…"
          accelerator={<KeyCombo combo={uiStore.hotkeyMap.workspaceGroup} />}
          onClick={uiStore.openLayerGrouping}
          disabled={workspace.selection.size < 2}
        />
        <MenuItem
          icon={IconSet.CLOSE}
          text="Ungroup"
          accelerator={<KeyCombo combo={uiStore.hotkeyMap.workspaceUngroup} />}
          onClick={workspace.ungroupSelection}
          disabled={groups.length === 0}
        />
        {groups.length === 1 && (
          <MenuItem
            icon={groups[0].isLocked ? IconSet.UNLOCK : IconSet.LOCK}
            text={groups[0].isLocked ? 'Unlock the group' : 'Lock the group'}
            onClick={() => workspace.toggleGroupLock(groups[0].id)}
          />
        )}
      </Menu>,
    );
  };

  return (
    <div
      ref={list}
      className="workspace-layer-list"
      role="listbox"
      aria-multiselectable
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropAt(undefined);
        }
      }}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        {rows.slice(first, last).map((row, i) =>
          row.kind === 'group' ? (
            <GroupRow
              key={`group-${row.group.id}`}
              group={row.group}
              members={row.members}
              top={(first + i) * ROW_HEIGHT}
              workspace={workspace}
              isExpanded={expanded.has(row.group.id)}
              onToggleExpanded={() => toggleExpanded(row.group.id)}
              onDragStart={(event) =>
                startDrag(
                  event,
                  row.members.map((member) => member.id),
                )
              }
              onDragEnd={endDrag}
              onContextMenu={handleContextMenu}
              onVisibilityDown={(currentlyHidden) =>
                startVisibilityPaint(
                  row.members.map((m) => m.id),
                  currentlyHidden,
                )
              }
              onVisibilityEnter={() => continueVisibilityPaint(row.members.map((m) => m.id))}
            />
          ) : (
            <LayerRow
              key={row.item.id}
              layer={row.item}
              isInGroup={row.group !== undefined}
              top={(first + i) * ROW_HEIGHT}
              workspace={workspace}
              images={images}
              onDragStart={(event) => startDrag(event, [row.item.id])}
              onDragEnd={endDrag}
              onContextMenu={handleContextMenu}
              onLook={() => workspaceStore.surface?.lookAt(row.item.id)}
              onVisibilityDown={(currentlyHidden) =>
                startVisibilityPaint([row.item.id], currentlyHidden)
              }
              onVisibilityEnter={() => continueVisibilityPaint([row.item.id])}
            />
          ),
        )}
        {dropAt !== undefined && (
          <div className="workspace-layer-drop" style={{ top: dropAt * ROW_HEIGHT - 1 }} />
        )}
      </div>
    </div>
  );
});

interface GroupRowProps {
  group: LayerGroup;
  members: readonly WorkspaceItem[];
  top: number;
  workspace: ClientWorkspace;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onVisibilityDown: (currentlyHidden: boolean) => void;
  onVisibilityEnter: () => void;
}

/**
 * A group of layers: opened and closed by its arrow, selected whole by a click, renamed by a double click,
 * and locked (its layers are one) or unlocked by its lock
 */
const GroupRow = observer((props: GroupRowProps) => {
  const {
    group,
    members,
    top,
    workspace,
    isExpanded,
    onToggleExpanded,
    onDragStart,
    onDragEnd,
    onContextMenu,
    onVisibilityDown,
    onVisibilityEnter,
  } = props;
  const [isRenaming, setIsRenaming] = useState(false);
  const isSelected = members.every((member) => workspace.selection.has(member.id));
  const isAllHidden = members.length > 0 && members.every((member) => member.isHidden === true);
  return (
    <div
      className="workspace-layer workspace-layer-group"
      role="option"
      aria-selected={isSelected}
      aria-expanded={isExpanded}
      data-hidden={isAllHidden}
      style={{ top, height: ROW_HEIGHT }}
      draggable={!workspace.isLocked && !isRenaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(event) =>
        workspace.selectGroup(group.id, event.shiftKey || event.ctrlKey || event.metaKey)
      }
      onContextMenu={(event) => {
        if (!isSelected) {
          workspace.selectGroup(group.id, false);
        }
        onContextMenu(event);
      }}
      onDoubleClick={() => setIsRenaming(true)}
      data-tooltip="A group of layers: double click to rename it"
    >
      <button
        className="workspace-layer-caret btn-icon"
        aria-label={isExpanded ? 'Close the group' : 'Open the group'}
        onClick={(event) => {
          event.stopPropagation();
          onToggleExpanded();
        }}
      >
        {isExpanded ? IconSet.ARROW_DOWN : IconSet.ARROW_RIGHT}
      </button>
      <span className="workspace-layer-preview">{IconSet.LAYERS}</span>
      {isRenaming ? (
        <input
          className="workspace-layer-rename"
          autoFocus
          defaultValue={group.name}
          aria-label="Name of the group"
          onFocus={(event) => event.target.select()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              workspace.renameGroup(group.id, event.currentTarget.value);
              setIsRenaming(false);
            } else if (event.key === 'Escape') {
              setIsRenaming(false);
            }
          }}
          onBlur={(event) => {
            workspace.renameGroup(group.id, event.currentTarget.value);
            setIsRenaming(false);
          }}
        />
      ) : (
        <span className="workspace-layer-name">{group.name}</span>
      )}
      <span className="workspace-layer-count">{members.length.toLocaleString()}</span>
      <button
        className="workspace-layer-lock btn-icon"
        aria-label={group.isLocked ? 'Unlock the group' : 'Lock the group'}
        aria-pressed={group.isLocked}
        data-tooltip={
          group.isLocked
            ? 'Locked: its layers are selected and moved as one'
            : 'Unlocked: each layer on its own'
        }
        onClick={(event) => {
          event.stopPropagation();
          workspace.toggleGroupLock(group.id);
        }}
      >
        {group.isLocked ? IconSet.LOCK : IconSet.UNLOCK}
      </button>
      {!workspace.isLocked && (
        <VisibilityToggle
          isHidden={isAllHidden}
          label={isAllHidden ? `Show ${group.name}` : `Hide ${group.name}`}
          onDown={() => onVisibilityDown(isAllHidden)}
          onEnter={onVisibilityEnter}
        />
      )}
    </div>
  );
});

interface LayerRowProps {
  layer: WorkspaceItem;
  /** Shown under its group, set in */
  isInGroup: boolean;
  top: number;
  workspace: ClientWorkspace;
  images: WorkspaceImages;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onLook: () => void;
  onVisibilityDown: (currentlyHidden: boolean) => void;
  onVisibilityEnter: () => void;
}

const LayerRow = observer((props: LayerRowProps) => {
  const {
    layer,
    isInGroup,
    top,
    workspace,
    images,
    onDragStart,
    onDragEnd,
    onContextMenu,
    onLook,
    onVisibilityDown,
    onVisibilityEnter,
  } = props;
  const { workspaceStore } = useStore();
  const isCropped = workspace.cropping?.id === layer.id;
  const isHidden = layer.isHidden === true;
  const source = layer.kind === 'image' ? images.sources.get(layer.fileId) : undefined;
  const name =
    layer.kind === 'image'
      ? source?.name ?? 'Image'
      : layer.kind === 'text'
      ? layer.text.split('\n')[0] || 'Text'
      : `Background, ${layer.format}`;

  return (
    <div
      className="workspace-layer"
      role="option"
      aria-selected={workspace.selection.has(layer.id)}
      data-cropping={isCropped}
      data-in-group={isInGroup}
      data-hidden={isHidden}
      style={{ top, height: ROW_HEIGHT }}
      draggable={!workspace.isLocked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(event) =>
        workspace.select(layer.id, event.shiftKey || event.ctrlKey || event.metaKey)
      }
      onContextMenu={(event) => {
        if (!workspace.selection.has(layer.id)) {
          workspace.select(layer.id, false);
        }
        onContextMenu(event);
      }}
      onDoubleClick={onLook}
      data-tooltip="Drag up or down to change its layer; double click to go to it"
    >
      <span className="workspace-layer-preview">
        {layer.kind === 'image' ? (
          source !== undefined && <img src={source.src} alt="" loading="lazy" draggable={false} />
        ) : layer.kind === 'text' ? (
          <span style={{ color: layer.color || undefined }}>{IconSet.TEXT}</span>
        ) : (
          <span className="workspace-layer-swatch" style={{ background: layer.color }} />
        )}
      </span>
      <span className="workspace-layer-name">{name}</span>
      {/* Cropping this image: started here (the camera glides to it) and done here */}
      {layer.kind === 'image' && !workspace.isLocked && (
        <button
          className="workspace-layer-crop btn-icon"
          aria-label={isCropped ? 'Done cropping' : 'Crop'}
          aria-pressed={isCropped}
          onClick={(event) => {
            event.stopPropagation();
            if (isCropped) {
              workspace.applyCrop();
            } else {
              // By its id: selecting it would bring the rest of a locked group with it
              workspaceStore.surface?.startCrop(layer.id);
            }
          }}
        >
          {IconSet.CROP}
        </button>
      )}
      {!workspace.isLocked && (
        <VisibilityToggle
          isHidden={isHidden}
          label={isHidden ? `Show ${name}` : `Hide ${name}`}
          onDown={() => onVisibilityDown(isHidden)}
          onEnter={onVisibilityEnter}
        />
      )}
    </div>
  );
});

/** Eye toggle aligned at the right edge of every group and layer row; supports click-hold-drag paint */
function VisibilityToggle({
  isHidden,
  label,
  onDown,
  onEnter,
}: {
  isHidden: boolean;
  label: string;
  onDown: () => void;
  onEnter: () => void;
}) {
  return (
    <button
      type="button"
      className="workspace-layer-visibility btn-icon"
      aria-label={label}
      aria-pressed={!isHidden}
      data-tooltip="Click or drag down to hide/show layers"
      draggable={false}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        onDown();
      }}
      onPointerEnter={onEnter}
      onClick={(event) => event.stopPropagation()}
    >
      {isHidden ? (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" strokeOpacity="0.45" />
          <path d="M2.5 13.5L13.5 2.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" />
          <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
        </svg>
      )}
    </button>
  );
}

/** The words, size and colour of the text that is selected */
const TextEditor = observer(
  ({ workspace, text }: { workspace: ClientWorkspace; text: WorkspaceTextItem }) => {
    const { uiStore } = useStore();
    const field = useRef<HTMLTextAreaElement>(null);
    const [words, setWords] = useState(text.text);
    const pending = useRef<ReturnType<typeof setTimeout>>();

    // Asked for with a double click on the text, or when it was just made
    const toEdit = uiStore.workspaceTextToEdit;
    useEffect(() => {
      if (toEdit === text.id && field.current !== null) {
        field.current.focus();
        field.current.select();
        uiStore.clearWorkspaceTextToEdit();
      }
    }, [toEdit, text.id, uiStore]);

    // What is typed is stored a moment after the last key, and when leaving the field
    const store = (value: string) => {
      clearTimeout(pending.current);
      if (value !== text.text) {
        workspace.changeText(text.id, { text: value });
      }
    };
    useEffect(() => () => clearTimeout(pending.current), []);
    // Changed from elsewhere (undone): the field follows, unless it is being typed in
    useEffect(() => {
      if (document.activeElement !== field.current) {
        setWords(text.text);
      }
    }, [text.text]);

    return (
      <section className="workspace-text-editor" aria-label="Text">
        <textarea
          ref={field}
          value={words}
          rows={3}
          disabled={workspace.isLocked}
          aria-label="Words"
          onChange={(event) => {
            const value = event.target.value;
            setWords(value);
            clearTimeout(pending.current);
            pending.current = setTimeout(() => store(value), TYPING_DELAY);
          }}
          onBlur={() => store(words)}
          // The keys of the workspace (Delete, L, G...) are for the workspace, not while typing
          onKeyDown={(event) => event.stopPropagation()}
        />
        <label>
          Size
          <input
            type="number"
            min={MIN_FONT_SIZE}
            step={2}
            value={Math.round(text.fontSize)}
            disabled={workspace.isLocked}
            onChange={(event) => {
              const fontSize = event.target.valueAsNumber;
              if (Number.isFinite(fontSize)) {
                workspace.changeText(text.id, { fontSize });
              }
            }}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
        <TagColorPicker
          color={text.color}
          onPick={(color) => workspace.changeText(text.id, { color })}
        />
      </section>
    );
  },
);

/** The colour and the format of the background that is selected */
const BackgroundEditor = observer(
  ({
    workspace,
    background,
  }: {
    workspace: ClientWorkspace;
    background: WorkspaceBackgroundItem;
  }) => (
    <section className="workspace-text-editor" aria-label="Background">
      <label>
        Format
        <select
          value={background.format}
          disabled={workspace.isLocked}
          onChange={(event) =>
            workspace.changeBackground(background.id, { format: event.target.value })
          }
        >
          {PAPER_FORMATS.map((format) => (
            <option key={format.name} value={format.name}>
              {format.name}
            </option>
          ))}
        </select>
      </label>
      <TagColorPicker
        color={background.color}
        onPick={(color) => workspace.changeBackground(background.id, { color: color || '#ffffff' })}
      />
    </section>
  ),
);

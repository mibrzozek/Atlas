import { action, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useReducer } from 'react';

import { OutlinerSort, sortedByName } from 'common/collections';
import { IconSet, Tree } from 'widgets';
import MultiSplitPane, { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { useContextMenu } from 'widgets/menus';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { ITreeItem, TreeLabel, createBranchOnKeyDown, createLeafOnKeyDown } from 'widgets/tree';
import { ROOT_TAG_ID } from '../../../../api/tag';
import { useStore } from '../../../contexts/StoreContext';
import { useTagDnD } from '../../../contexts/TagDnDContext';
import { ClientTagSearchCriteria } from '../../../entities/SearchCriteria';
import { ClientTag } from '../../../entities/Tag';
import { TagCounts } from '../PanelCounts';
import { useAction } from '../../../hooks/mobx';
import useLocalStorage from '../../../hooks/useLocalStorage';
import TagStore from '../../../stores/TagStore';
import UiStore from '../../../stores/UiStore';
import { IExpansionState } from '../../types';
import TreeItemRevealer from '../TreeItemRevealer';
import { TagItemContextMenu } from './ContextMenu';
import { useTagItemDnD } from './useTagItemDnD';
import { Action, Factory, State, reducer } from './state';

export class TagsTreeItemRevealer extends TreeItemRevealer {
  public static readonly instance: TagsTreeItemRevealer = new TagsTreeItemRevealer();
  private constructor() {
    super();
    this.revealTag = action(this.revealTag.bind(this));
  }

  initialize(setExpansion: React.Dispatch<React.SetStateAction<IExpansionState>>) {
    super.initializeExpansion(setExpansion);
  }

  revealTag(tag: ClientTag) {
    const tagsToExpand = Array.from(tag.getAncestors(), (t) => t.id);
    tagsToExpand.push(ROOT_TAG_ID);
    this.revealTreeItem(tagsToExpand);
  }
}

interface ITagItemProps {
  nodeData: ClientTag;
  dispatch: React.Dispatch<Action>;
  pos: number;
  expansion: IExpansionState;
  /** Tags can only be dragged to another place while they are sorted by hand */
  isManualSort: boolean;
}

/**
 * Opens the tag in the gallery. With ctrl (or cmd) it is added to what is shown already, or taken out of it.
 */
const viewTag = (nodeData: ClientTag, uiStore: UiStore, isAdditive: boolean) => {
  if (!isAdditive) {
    uiStore.replaceSearchCriteria(new ClientTagSearchCriteria('tags', nodeData.id));
    return;
  }
  const crit = uiStore.searchCriteriaList.find(
    (c) => c instanceof ClientTagSearchCriteria && c.value === nodeData.id,
  );
  if (crit) {
    uiStore.removeSearchCriteria(crit);
  } else {
    uiStore.addSearchCriteria(new ClientTagSearchCriteria('tags', nodeData.id));
  }
};

const TagItem = observer((props: ITagItemProps) => {
  const { nodeData, dispatch, expansion, pos, isManualSort } = props;
  const { uiStore } = useStore();

  const show = useContextMenu();
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) =>
      show(
        e.clientX,
        e.clientY,
        <TagItemContextMenu tag={nodeData} pos={pos} isManualSort={isManualSort} />,
      ),
    [isManualSort, nodeData, pos, show],
  );

  const dnd = useTagItemDnD({
    tag: nodeData,
    pos,
    // In alphabetical order there is no place to drop a tag
    canReorder: isManualSort,
    isExpanded: !!expansion[nodeData.id],
    expand: () => dispatch(Factory.expandNode(nodeData.id)),
  });

  // Clicking anywhere on the tag opens it in the gallery
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      runInAction(() => viewTag(nodeData, uiStore, event.ctrlKey || event.metaKey));
    },
    [nodeData, uiStore],
  );

  useEffect(
    () =>
      TagsTreeItemRevealer.instance.initialize(
        (val: IExpansionState | ((prevState: IExpansionState) => IExpansionState)) =>
          dispatch(Factory.setExpansion(val)),
      ),
    [dispatch],
  );

  return (
    <div
      className="tree-content-label"
      draggable
      {...dnd}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      <span style={{ color: nodeData.viewColor }}>
        {nodeData.isHidden ? IconSet.HIDDEN : IconSet.TAG}
      </span>
      <div
        className="label-text"
        data-tooltip={`${nodeData.path.join(' › ')} (${nodeData.fileCount})`}
      >
        {nodeData.name}
      </div>
    </div>
  );
});

interface ITreeData {
  state: State;
  dispatch: React.Dispatch<Action>;
  sort: OutlinerSort;
}

const TagItemLabel: TreeLabel = ({
  nodeData,
  treeData,
  pos,
}: {
  nodeData: ClientTag;
  treeData: ITreeData;
  pos: number;
}) => (
  <TagItem
    nodeData={nodeData}
    dispatch={treeData.dispatch}
    expansion={treeData.state.expansion}
    pos={pos}
    isManualSort={treeData.sort === 'manual'}
  />
);

const isSelected = (nodeData: ClientTag): boolean => nodeData.isSelected;

const isExpanded = (nodeData: ClientTag, treeData: ITreeData): boolean =>
  !!treeData.state.expansion[nodeData.id];

const toggleExpansion = (nodeData: ClientTag, treeData: ITreeData) =>
  treeData.dispatch(Factory.toggleNode(nodeData.id));

const toggleSelection = (uiStore: UiStore, nodeData: ClientTag) =>
  uiStore.toggleTagSelection(nodeData);

const triggerContextMenuEvent = (event: React.KeyboardEvent<HTMLLIElement>) => {
  const element = event.currentTarget.querySelector('.tree-content-label');
  if (element !== null) {
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: rect.right,
        clientY: rect.top,
        bubbles: true,
      }),
    );
  }
};

const customKeys = (
  uiStore: UiStore,
  tagStore: TagStore,
  event: React.KeyboardEvent<HTMLLIElement>,
  nodeData: ClientTag,
) => {
  switch (event.key) {
    case 'F10':
      if (event.shiftKey) {
        triggerContextMenuEvent(event);
      }
      break;

    case 'Enter':
      event.stopPropagation();
      viewTag(nodeData, uiStore, event.ctrlKey || event.metaKey);
      break;

    case 'ContextMenu':
      triggerContextMenuEvent(event);
      break;

    default:
      break;
  }
};

/** Sorted by hand is the order the tags are stored in; by name is only how they are shown */
const mapTags = (tags: readonly ClientTag[], sort: OutlinerSort): ITreeItem[] =>
  (sort === 'name' ? sortedByName(tags) : tags).map((tag) => mapTag(tag, sort));

const mapTag = (tag: ClientTag, sort: OutlinerSort): ITreeItem => ({
  id: tag.id,
  label: TagItemLabel,
  children: mapTags(tag.subTags, sort),
  nodeData: tag,
  isExpanded,
  isSelected,
  className: tag.isSearched ? 'searched' : undefined,
});

const TagsTree = observer((props: Partial<MultiSplitPaneProps>) => {
  const { tagStore, uiStore } = useStore();
  const root = tagStore.root;
  const [state, dispatch] = useReducer(reducer, { expansion: {} });
  const dndData = useTagDnD();
  const [sort, setSort] = useLocalStorage<OutlinerSort>('outliner-tag-sort', 'manual');

  /** Header and Footer drop zones of the root node */
  const handleDragOverAndLeave = useAction((event: React.DragEvent<HTMLDivElement>) => {
    if (dndData.source !== undefined) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const treeData: ITreeData = useMemo(() => ({ state, dispatch, sort }), [sort, state]);

  const handleDrop = useAction(() => {
    if (sort !== 'manual') {
      return;
    }
    if (dndData.source?.isSelected) {
      uiStore.moveSelectedTagItems(ROOT_TAG_ID);
    } else if (dndData.source !== undefined) {
      const { root } = tagStore;
      root.insertSubTag(dndData.source, root.subTags.length);
    }
  });

  const handleBranchOnKeyDown = useAction(
    (event: React.KeyboardEvent<HTMLLIElement>, nodeData: ClientTag, treeData: ITreeData) =>
      createBranchOnKeyDown(
        event,
        nodeData,
        treeData,
        isExpanded,
        toggleSelection.bind(null, uiStore),
        toggleExpansion,
        customKeys.bind(null, uiStore, tagStore),
      ),
  );

  const handleLeafOnKeyDown = useAction(
    (event: React.KeyboardEvent<HTMLLIElement>, nodeData: ClientTag, treeData: ITreeData) =>
      createLeafOnKeyDown(
        event,
        nodeData,
        treeData,
        toggleSelection.bind(null, uiStore),
        customKeys.bind(null, uiStore, tagStore),
      ),
  );

  const handleKeyDown = useAction((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      uiStore.clearTagSelection();
      (document.activeElement as HTMLElement | null)?.blur();
      e.stopPropagation();
    } else {
      props.onKeyDown?.(e);
    }
  });

  return (
    <MultiSplitPane
      id="tags"
      title="Tags"
      onKeyDown={handleKeyDown}
      headerProps={{
        onDragOver: handleDragOverAndLeave,
        onDragLeave: handleDragOverAndLeave,
        onDrop: handleDrop,
      }}
      headerToolbar={
        <Toolbar controls="tag-hierarchy" isCompact>
          {uiStore.tagSelection.size > 0 && (
            <ToolbarButton
              icon={IconSet.CLOSE}
              text="Clear"
              onClick={uiStore.clearTagSelection}
              tooltip="Clear Selection"
            />
          )}
          <ToolbarButton
            icon={sort === 'name' ? IconSet.FILTER_NAME_DOWN : IconSet.TREE_LIST}
            text="Sort"
            onClick={() => setSort(sort === 'name' ? 'manual' : 'name')}
            tooltip={
              sort === 'name'
                ? 'Sorted alphabetically. Click to sort by hand: drag tags to where you want them'
                : 'Sorted by hand: drag tags to where you want them. Click to sort alphabetically'
            }
          />
          <ToolbarButton
            icon={IconSet.EDIT}
            text="Edit"
            onClick={uiStore.openTagManager}
            tooltip="Edit tags and collections"
          />
        </Toolbar>
      }
      {...props}
    >
      {root.subTags.length === 0 ? (
        <div className="tree-content-label" style={{ padding: '0.25rem' }}>
          {/* <span className="pre-icon">{IconSet.INFO}</span> */}
          {/* No tags or collections created yet */}
          <i style={{ marginLeft: '1em' }}>None</i>
        </div>
      ) : (
        <Tree
          multiSelect
          id="tag-hierarchy"
          className={uiStore.tagSelection.size > 0 ? 'selected' : undefined}
          children={mapTags(root.subTags, sort)}
          treeData={treeData}
          toggleExpansion={toggleExpansion}
          onBranchKeyDown={handleBranchOnKeyDown}
          onLeafKeyDown={handleLeafOnKeyDown}
        />
      )}

      {/* Used for dragging collection to root of hierarchy and for deselecting tag selection */}
      <div
        id="tree-footer"
        onClick={uiStore.clearTagSelection}
        onDragOver={handleDragOverAndLeave}
        onDragLeave={handleDragOverAndLeave}
        onDrop={handleDrop}
      />
      {!tagStore.isEmpty && <TagCounts />}
    </MultiSplitPane>
  );
});

export default TagsTree;

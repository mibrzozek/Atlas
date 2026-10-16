import { observer } from 'mobx-react-lite';
import React, { useMemo, useRef, useState } from 'react';

import { sortedByName } from 'common/collections';
import { IconSet, Tree } from 'widgets';
import { ITreeItem, TreeLabel, createBranchOnKeyDown, createLeafOnKeyDown } from 'widgets/tree';
import { ROOT_TAG_ID } from '../../api/tag';
import { useStore } from '../contexts/StoreContext';
import { useTagDnD } from '../contexts/TagDnDContext';
import { ClientTag } from '../entities/Tag';
import { useAction } from '../hooks/mobx';
import UiStore from '../stores/UiStore';
import { useTagItemDnD } from './Outliner/TagsPanel/useTagItemDnD';
import { IExpansionState } from './types';

interface ITreeData {
  expansion: IExpansionState;
  setExpansion: React.Dispatch<React.SetStateAction<IExpansionState>>;
  /** While looking for a tag, everything that is shown is expanded */
  isFiltering: boolean;
  /** Sorted by name or date: a plain list, in which dragging cannot put tags in order or inside each other */
  isFlat: boolean;
  editableId: string | undefined;
  setEditableId: (id: string | undefined) => void;
  select: (event: React.MouseEvent, tag: ClientTag) => void;
}

interface TagItemProps {
  tag: ClientTag;
  pos: number;
  treeData: ITreeData;
}

const TagItem = observer(({ tag, pos, treeData }: TagItemProps) => {
  const { expansion, setExpansion, editableId, setEditableId, select } = treeData;
  const { collectionStore } = useStore();
  const isEditing = editableId === tag.id;
  const collections = collectionStore.collectionsOf(tag);

  const dnd = useTagItemDnD({
    tag,
    pos,
    canReorder: !treeData.isFlat,
    isExpanded: !!expansion[tag.id],
    expand: () => setExpansion((val) => ({ ...val, [tag.id]: true })),
  });

  return (
    <div
      className="tree-content-label"
      draggable={!isEditing}
      {...dnd}
      onClick={(event) => {
        event.stopPropagation();
        select(event, tag);
      }}
      onDoubleClick={() => setEditableId(tag.id)}
    >
      <span style={{ color: tag.viewColor }}>{tag.isHidden ? IconSet.HIDDEN : IconSet.TAG}</span>
      {isEditing ? (
        <input
          className="input"
          autoFocus
          type="text"
          defaultValue={tag.name}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value.length > 0) {
              tag.rename(value);
            }
            setEditableId(undefined);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              // Leaves the name as it was, and the dialog open
              e.preventDefault();
              e.currentTarget.value = '';
              e.currentTarget.blur();
            }
          }}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="label-text">
          {tag.name}
          {/* In a plain list: which tag it is inside of */}
          {treeData.isFlat && tag.path.length > 1 && (
            <span className="tag-manager-parent-path" title="The tag this one is inside of">
              {tag.path.slice(0, -1).join(' › ')}
            </span>
          )}
        </div>
      )}
      {!isEditing && collections.length > 0 && (
        <span className="tag-manager-memberships" title="The collections this tag is in">
          {collections.map((collection) => collection.name).join(', ')}
        </span>
      )}
      <span className="tag-manager-count" title="Images with this tag">
        {tag.fileCount}
      </span>
    </div>
  );
});

const TagItemLabel: TreeLabel = ({
  nodeData,
  treeData,
  pos,
}: {
  nodeData: ClientTag;
  treeData: ITreeData;
  pos: number;
}) => <TagItem tag={nodeData} treeData={treeData} pos={pos} />;

const isSelected = (nodeData: ClientTag): boolean => nodeData.isSelected;

const isExpanded = (nodeData: ClientTag, treeData: ITreeData): boolean =>
  treeData.isFiltering || !!treeData.expansion[nodeData.id];

const toggleExpansion = (nodeData: ClientTag, treeData: ITreeData) =>
  treeData.setExpansion((val) => ({ ...val, [nodeData.id]: !val[nodeData.id] }));

const toggleSelection = (uiStore: UiStore, nodeData: ClientTag) =>
  uiStore.toggleTagSelection(nodeData);

const customKeys = (
  event: React.KeyboardEvent<HTMLLIElement>,
  nodeData: ClientTag,
  treeData: ITreeData,
) => {
  if (event.key === 'F2') {
    event.stopPropagation();
    treeData.setEditableId(nodeData.id);
  }
};

/** With a filter: only the tags that match, and the tags they are inside of */
const mapTags = (
  tags: readonly ClientTag[],
  matches: ((tag: ClientTag) => boolean) | undefined,
): ITreeItem[] => {
  const items: ITreeItem[] = [];
  for (const tag of tags) {
    const children = mapTags(tag.subTags, matches);
    if (matches === undefined || children.length > 0 || matches(tag)) {
      items.push({
        id: tag.id,
        label: TagItemLabel,
        children,
        nodeData: tag,
        isExpanded,
        isSelected,
      });
    }
  }
  return items;
};

/** As the tree they are stored in, or as a plain list by name or by when they were made (newest first) */
export type TagManagerSort = 'hierarchy' | 'name' | 'date';

interface TagManagerTreeProps {
  /** Lower-cased text to look for in the names; empty for all tags */
  query: string;
  sort: TagManagerSort;
  /** Only the tags that are in no collection */
  onlyLoose: boolean;
  editableId: string | undefined;
  setEditableId: (id: string | undefined) => void;
}

/**
 * All tags as the tree they are stored in, like the list in the side panel used to be. Click selects
 * (with ctrl and shift for several), dragging moves tags above, below or into another tag,
 * and a double click or F2 renames.
 */
const TagManagerTree = observer((props: TagManagerTreeProps) => {
  const { query, sort, onlyLoose, editableId, setEditableId } = props;
  const { collectionStore, tagStore, uiStore } = useStore();
  const isFlat = sort !== 'hierarchy';
  /** The tags in the order they are listed, when that is not the order of the tree */
  const flatOrder = useRef<ClientTag[]>();
  const dndData = useTagDnD();
  const [expansion, setExpansion] = useState<IExpansionState>({});

  /** The first item that is selected in a multi-selection */
  const initialSelectionIndex = useRef<number>();
  /** The last item that is selected in a multi-selection */
  const lastSelectionIndex = useRef<number>();
  const select = useAction((e: React.MouseEvent, selectedTag: ClientTag) => {
    const rangeSelection = e.shiftKey;
    const expandSelection = e.ctrlKey || e.metaKey;
    const order = flatOrder.current;
    const i =
      order !== undefined
        ? Math.max(0, order.indexOf(selectedTag))
        : tagStore.findFlatTagListIndex(selectedTag);

    if (lastSelectionIndex.current === undefined || uiStore.tagSelection.size === 0) {
      initialSelectionIndex.current = i;
      lastSelectionIndex.current = i;
      uiStore.selectTag(selectedTag, true);
      return;
    }
    lastSelectionIndex.current = i;

    if (rangeSelection && initialSelectionIndex.current !== undefined) {
      if (i === undefined) {
        return;
      }
      if (order !== undefined) {
        // A range of the list as it is shown
        const from = Math.min(i, initialSelectionIndex.current);
        const to = Math.max(i, initialSelectionIndex.current);
        if (!expandSelection) {
          uiStore.clearTagSelection();
        }
        order.slice(from, to + 1).forEach((tag) => uiStore.selectTag(tag));
      } else if (i < initialSelectionIndex.current) {
        uiStore.selectTagRange(i, initialSelectionIndex.current, expandSelection);
      } else {
        uiStore.selectTagRange(initialSelectionIndex.current, i, expandSelection);
      }
    } else if (expandSelection) {
      uiStore.toggleTagSelection(selectedTag);
      initialSelectionIndex.current = i;
    } else {
      if (selectedTag.isSelected && uiStore.tagSelection.size === 1) {
        uiStore.clearTagSelection();
      } else {
        uiStore.selectTag(selectedTag, true);
      }
      initialSelectionIndex.current = i;
    }
  });

  // Read here so the rows are drawn again whenever the selection changes: the tree itself does not watch it
  const selectionSize = uiStore.tagSelection.size;
  Array.from(uiStore.tagSelection, (tag) => tag.id);

  const isFiltering = query.length > 0 || onlyLoose;
  const treeData: ITreeData = useMemo(
    () => ({ expansion, setExpansion, isFiltering, isFlat, editableId, setEditableId, select }),
    [editableId, expansion, isFiltering, isFlat, select, setEditableId],
  );

  /** Dropping underneath the list moves a tag out of the tag it was in, to the end */
  const handleDragOverFooter = useAction((event: React.DragEvent<HTMLDivElement>) => {
    if (dndData.source !== undefined && !isFlat) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  const handleDropFooter = useAction(() => {
    if (isFlat) {
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
        customKeys,
      ),
  );

  const handleLeafOnKeyDown = useAction(
    (event: React.KeyboardEvent<HTMLLIElement>, nodeData: ClientTag, treeData: ITreeData) =>
      createLeafOnKeyDown(
        event,
        nodeData,
        treeData,
        toggleSelection.bind(null, uiStore),
        customKeys,
      ),
  );

  const matches = isFiltering
    ? (tag: ClientTag) =>
        tag.id === editableId ||
        (tag.name.toLowerCase().includes(query) &&
          (!onlyLoose || collectionStore.collectionsOf(tag).length === 0))
    : undefined;
  let items: ITreeItem[];
  if (isFlat) {
    const listed = tagStore.tagList.filter((tag) => matches === undefined || matches(tag));
    const ordered =
      sort === 'name'
        ? sortedByName(listed)
        : listed.slice().sort((a, b) => b.dateAdded.getTime() - a.dateAdded.getTime());
    flatOrder.current = ordered;
    items = ordered.map((tag) => ({
      id: tag.id,
      label: TagItemLabel,
      children: [],
      nodeData: tag,
      isExpanded,
      isSelected,
    }));
  } else {
    flatOrder.current = undefined;
    items = mapTags(tagStore.root.subTags, matches);
  }

  return (
    <div className="tag-manager-tree">
      {items.length === 0 ? (
        <p className="tag-manager-empty">
          {tagStore.isEmpty
            ? 'There are no tags yet.'
            : onlyLoose && query.length === 0
            ? 'Every tag is in a collection.'
            : 'No tag matches.'}
        </p>
      ) : (
        <Tree
          multiSelect
          id="tag-manager-hierarchy"
          className={selectionSize > 0 ? 'selected' : undefined}
          children={items}
          treeData={treeData}
          toggleExpansion={toggleExpansion}
          onBranchKeyDown={handleBranchOnKeyDown}
          onLeafKeyDown={handleLeafOnKeyDown}
        />
      )}
      <div
        className="tag-manager-tree-footer"
        onClick={uiStore.clearTagSelection}
        onDragOver={handleDragOverFooter}
        onDragLeave={handleDragOverFooter}
        onDrop={handleDropFooter}
      />
    </div>
  );
});

export default TagManagerTree;

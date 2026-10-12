import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';

import { OutlinerSort } from 'common/collections';
import { IconSet } from 'widgets';
import MultiSplitPane, { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../../contexts/StoreContext';
import { useTagDnD } from '../../../contexts/TagDnDContext';
import { ClientTagSearchCriteria } from '../../../entities/SearchCriteria';
import { ClientTag } from '../../../entities/Tag';
import useLocalStorage from '../../../hooks/useLocalStorage';
import { ClientCollection } from '../../../stores/CollectionStore';

const COLLECTION_DND_TYPE = 'application/x-atlas-collection';

/** Where a dragged collection would land: above or below the one it is held over */
type DropPlace = { id: string; where: 'top' | 'bottom' };

interface CollectionItemProps {
  collection: ClientCollection;
  isManualSort: boolean;
  isExpanded: boolean;
  toggleExpansion: (id: string) => void;
  draggedId: string | undefined;
  setDraggedId: (id: string | undefined) => void;
  dropPlace: DropPlace | undefined;
  setDropPlace: (place: DropPlace | undefined) => void;
}

const CollectionItem = observer((props: CollectionItemProps) => {
  const { collection, isManualSort, isExpanded, toggleExpansion } = props;
  const { draggedId, setDraggedId, dropPlace, setDropPlace } = props;
  const { collectionStore, uiStore } = useStore();
  const tagDnD = useTagDnD();
  const tags = collectionStore.getTags(collection);
  const isViewed = collectionStore.isViewed(collection);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    // A tag from the list of tags: dropping it adds it to this collection
    if (runInAction(() => tagDnD.source !== undefined)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDropPlace(undefined);
      event.currentTarget.dataset.dndTarget = 'true';
      event.currentTarget.classList.add('center');
      return;
    }
    if (!isManualSort || draggedId === undefined || draggedId === collection.id) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const where = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
    if (dropPlace?.id !== collection.id || dropPlace.where !== where) {
      setDropPlace({ id: collection.id, where });
    }
  };

  const clearTagTarget = (element: HTMLDivElement) => {
    delete element.dataset.dndTarget;
    element.classList.remove('center');
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    clearTagTarget(event.currentTarget);
    runInAction(() => {
      const tag = tagDnD.source;
      if (tag !== undefined) {
        // All selected tags when the dragged one is part of a selection
        const dropped: ClientTag[] = tag.isSelected ? Array.from(uiStore.tagSelection) : [tag];
        dropped.forEach((t) => collectionStore.addTag(collection, t));
        return;
      }
      const list = collectionStore.collectionList;
      const source = list.find((c) => c.id === draggedId);
      if (!isManualSort || source === undefined || dropPlace?.id !== collection.id) {
        return;
      }
      const from = list.indexOf(source);
      const target = list.indexOf(collection);
      // The position it has once it is taken out of where it was
      const to = dropPlace.where === 'top' ? target : target + 1;
      collectionStore.move(source, from < target ? to - 1 : to);
    });
    setDropPlace(undefined);
    setDraggedId(undefined);
  };

  const isDropTarget = dropPlace?.id === collection.id;
  return (
    <li role="treeitem" aria-expanded={isExpanded} className={isViewed ? 'searched' : undefined}>
      <div
        className={`tree-content-label collection-label ${isDropTarget ? dropPlace.where : ''}`}
        data-dnd-target={isDropTarget || undefined}
        data-dnd-source={draggedId === collection.id || undefined}
        draggable={isManualSort}
        onDragStart={(event) => {
          event.dataTransfer.setData(COLLECTION_DND_TYPE, collection.id);
          event.dataTransfer.effectAllowed = 'move';
          setDraggedId(collection.id);
        }}
        onDragEnd={() => {
          setDraggedId(undefined);
          setDropPlace(undefined);
        }}
        onDragOver={handleDragOver}
        onDragLeave={(event) => clearTagTarget(event.currentTarget)}
        onDrop={handleDrop}
        onClick={() => collectionStore.view(collection)}
      >
        <button
          className="btn-icon collection-caret"
          aria-label={isExpanded ? 'Hide its tags' : 'Show its tags'}
          disabled={tags.length === 0}
          onClick={(event) => {
            event.stopPropagation();
            toggleExpansion(collection.id);
          }}
        >
          {isExpanded ? IconSet.ARROW_DOWN : IconSet.ARROW_RIGHT}
        </button>
        <span>{IconSet.TAG_GROUP}</span>
        <div className="label-text" data-tooltip={tags.map((tag) => tag.name).join(', ')}>
          {collection.name}
        </div>
        <span className="collection-count">{tags.length}</span>
      </div>
      {isExpanded && tags.length > 0 && (
        <ul role="group">
          {tags.map((tag) => (
            <li key={tag.id} role="treeitem" className={tag.isSearched ? 'searched' : undefined}>
              <div
                className="tree-content-label collection-tag-label"
                onClick={(event) => {
                  event.stopPropagation();
                  uiStore.replaceSearchCriteria(new ClientTagSearchCriteria('tags', tag.id));
                }}
              >
                <span style={{ color: tag.viewColor }}>
                  {tag.isHidden ? IconSet.HIDDEN : IconSet.TAG}
                </span>
                <div className="label-text">{tag.name}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});

/**
 * The collections: named groups of tags. Clicking one shows the images that have any of its tags.
 * They are made and changed in the page for editing tags and collections; here they can only be put in order.
 */
const CollectionsPanel = observer((props: Partial<MultiSplitPaneProps>) => {
  const { collectionStore, uiStore } = useStore();
  const [sort, setSort] = useLocalStorage<OutlinerSort>('outliner-collection-sort', 'manual');
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string>();
  const [dropPlace, setDropPlace] = useState<DropPlace>();

  const toggleExpansion = useCallback(
    (id: string) => setExpansion((val) => ({ ...val, [id]: !val[id] })),
    [],
  );

  const collections =
    sort === 'name' ? collectionStore.sortedByName : collectionStore.collectionList.slice();

  return (
    <MultiSplitPane
      id="collections"
      title="Collections"
      headerToolbar={
        <Toolbar controls="collection-list" isCompact>
          <ToolbarButton
            icon={sort === 'name' ? IconSet.FILTER_NAME_DOWN : IconSet.TREE_LIST}
            text="Sort"
            onClick={() => setSort(sort === 'name' ? 'manual' : 'name')}
            tooltip={
              sort === 'name'
                ? 'Sorted alphabetically. Click to sort by hand: drag collections to where you want them'
                : 'Sorted by hand: drag collections to where you want them. Click to sort alphabetically'
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
      {collections.length === 0 ? (
        <div className="tree-content-label" style={{ padding: '0.25rem' }}>
          <i style={{ marginLeft: '1em' }}>None</i>
        </div>
      ) : (
        <ul id="collection-list" role="tree">
          {collections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              isManualSort={sort === 'manual'}
              isExpanded={!!expansion[collection.id]}
              toggleExpansion={toggleExpansion}
              draggedId={draggedId}
              setDraggedId={setDraggedId}
              dropPlace={dropPlace}
              setDropPlace={setDropPlace}
            />
          ))}
        </ul>
      )}
    </MultiSplitPane>
  );
});

export default CollectionsPanel;

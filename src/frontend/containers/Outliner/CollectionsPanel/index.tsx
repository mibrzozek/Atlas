import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';

import { OutlinerSort } from 'common/collections';
import { IconSet } from 'widgets';
import MultiSplitPane, { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../../contexts/StoreContext';
import { ClientTagSearchCriteria } from '../../../entities/SearchCriteria';
import useLocalStorage from '../../../hooks/useLocalStorage';
import { ClientCollection } from '../../../entities/Collection';
import { CollectionCounts } from '../PanelCounts';
import { useCollectionDnD } from './useCollectionDnD';

interface CollectionItemProps {
  collection: ClientCollection;
  isManualSort: boolean;
  isExpanded: boolean;
  toggleExpansion: (id: string) => void;
}

const CollectionItem = observer((props: CollectionItemProps) => {
  const { collection, isManualSort, isExpanded, toggleExpansion } = props;
  const { uiStore } = useStore();
  const { target, props: dnd } = useCollectionDnD(collection, isManualSort);
  const tags = collection.tags;
  const isViewed = collection.isViewed;

  return (
    <li role="treeitem" aria-expanded={isExpanded} className={isViewed ? 'searched' : undefined}>
      <div
        className={`tree-content-label collection-label ${
          target === 'tags' ? 'center' : target ?? ''
        }`}
        data-dnd-target={target !== undefined || undefined}
        {...dnd}
        onClick={() => collection.view()}
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
            />
          ))}
        </ul>
      )}
      {collections.length > 0 && <CollectionCounts />}
    </MultiSplitPane>
  );
});

export default CollectionsPanel;

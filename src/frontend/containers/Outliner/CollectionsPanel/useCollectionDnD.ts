import { runInAction } from 'mobx';
import React, { useState } from 'react';

import { useStore } from '../../../contexts/StoreContext';
import { useTagDnD } from '../../../contexts/TagDnDContext';
import { ClientCollection } from '../../../entities/Collection';

const COLLECTION_DND_TYPE = 'application/x-atlas-collection';

/** The collection that is being dragged to another place in a list of collections */
let dragged: ClientCollection | undefined;

/** What a drop on a collection would do: put the dragged collection above or below it, or add tags to it */
export type CollectionDropTarget = 'top' | 'bottom' | 'tags';

type DragEvent = React.DragEvent<HTMLElement>;

/**
 * Dragging a collection to another place in its list, and dropping things on it: a collection goes above
 * or below it, tags are added to it. The props that are returned go on the element of the collection.
 *
 * @param canReorder Not where the list is sorted by name: there is no place to drop a collection then
 */
export function useCollectionDnD(collection: ClientCollection, canReorder: boolean) {
  const { collectionStore, uiStore } = useStore();
  const tagDnD = useTagDnD();
  const [target, setTarget] = useState<CollectionDropTarget>();

  const props = {
    draggable: canReorder,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(COLLECTION_DND_TYPE, collection.id);
      event.dataTransfer.effectAllowed = 'move';
      dragged = collection;
    },
    onDragEnd: () => {
      dragged = undefined;
      setTarget(undefined);
    },
    onDragOver: (event: DragEvent) => {
      if (runInAction(() => tagDnD.source !== undefined)) {
        event.preventDefault();
        // What a dragged tag allows: 'copy' is not among it, and would make the drop be refused
        event.dataTransfer.dropEffect = 'link';
        setTarget('tags');
      } else if (canReorder && dragged !== undefined && dragged !== collection) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        setTarget(event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
      }
    },
    onDragLeave: () => setTarget(undefined),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const source = dragged;
      dragged = undefined;
      setTarget(undefined);
      runInAction(() => {
        const tag = tagDnD.source;
        if (tag !== undefined) {
          // All selected tags when the dragged one is part of the selection
          (tag.isSelected ? Array.from(uiStore.tagSelection) : [tag]).forEach(collection.add);
        } else if (source !== undefined && (target === 'top' || target === 'bottom')) {
          collectionStore.moveNextTo(source, collection, target === 'top' ? 'before' : 'after');
        }
      });
    },
  };

  return { target, props };
}

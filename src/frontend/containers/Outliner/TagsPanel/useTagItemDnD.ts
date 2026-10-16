import { runInAction } from 'mobx';
import React, { useRef } from 'react';

import { formatTagCountText } from 'common/fmt';
import { useStore } from '../../../contexts/StoreContext';
import { DnDTagType, useTagDnD } from '../../../contexts/TagDnDContext';
import { ClientTag } from '../../../entities/Tag';
import { HOVER_TIME_TO_EXPAND } from '../LocationsPanel/useFileDnD';
import { createDragReorderHelper } from '../TreeItemDnD';

const DnDHelper = createDragReorderHelper('tag-dnd-preview', DnDTagType);

type DragEvent = React.DragEvent<HTMLDivElement>;

interface TagItemDnD {
  tag: ClientTag;
  /** Its place among the tags it is listed with, counted from 1 */
  pos: number;
  /** Whether tags can be dropped here: not where the list is sorted by something else than by hand */
  canReorder: boolean;
  isExpanded: boolean;
  expand: () => void;
}

/**
 * Dragging a tag of a tree of tags, and dropping tags on it: above or below it to put them in order,
 * onto it to put them inside. Dragging a selected tag takes the whole selection along.
 * The props that are returned go on the element of the tag.
 */
export function useTagItemDnD({ tag, pos, canReorder, isExpanded, expand }: TagItemDnD) {
  const { uiStore } = useStore();
  const dndData = useTagDnD();

  // A tag only opens up after the pointer has rested on it for a moment
  const expandTimeout = useRef<number>();
  const cancelExpand = () => {
    window.clearTimeout(expandTimeout.current);
    expandTimeout.current = undefined;
  };

  return {
    onDragStart: (event: DragEvent) =>
      runInAction(() => {
        const dragged = tag.isSelected ? uiStore.getTagContextItems(tag.id) : [tag];
        const count = dragged.length > 1 ? formatTagCountText(dragged.length) : '';
        const name = dragged.length === 1 ? dragged[0].name : tag.name;
        DnDHelper.onDragStart(
          event,
          count.length > 0 ? `${name} (${count})` : name,
          uiStore.theme,
          dndData,
          tag,
        );
      }),

    onDragOver: (event: DragEvent) =>
      runInAction(() => {
        const { source } = dndData;
        if (
          !canReorder ||
          source === undefined ||
          (source.isSelected && tag.isSelected) ||
          tag.isAncestor(source) ||
          DnDHelper.onDragOver(event, dndData)
        ) {
          return;
        }
        // Held over its top or bottom edge, it goes above or below: no need to look inside
        const { classList } = event.currentTarget;
        if (classList.contains('top') || classList.contains('bottom')) {
          cancelExpand();
        } else if (!isExpanded && expandTimeout.current === undefined) {
          expandTimeout.current = window.setTimeout(() => {
            expandTimeout.current = undefined;
            expand();
          }, HOVER_TIME_TO_EXPAND);
        }
      }),

    onDragLeave: (event: DragEvent) => {
      if (runInAction(() => dndData.source !== undefined)) {
        DnDHelper.onDragLeave(event);
        cancelExpand();
      }
    },

    onDrop: (event: DragEvent) => {
      cancelExpand();
      runInAction(() => {
        const place = DnDHelper.onDrop(event);
        const { source } = dndData;
        if (!canReorder || source === undefined) {
          return;
        }
        if (place === 'middle') {
          expand();
        }
        // `pos` counts from 1, the places in the list from 0
        if (source.isSelected) {
          if (place === 'middle') {
            uiStore.moveSelectedTagItems(tag.id);
          } else {
            uiStore.moveSelectedTagItems(tag.parent.id, pos + place);
          }
        } else if (place === 'middle') {
          tag.insertSubTag(source, 0);
        } else {
          tag.parent.insertSubTag(source, pos + place);
        }
      });
    },
  };
}

import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';
import {
  ClientTagSearchCriteria,
  isTaggedCriteria,
  taggedCriteria,
} from '../../entities/SearchCriteria';
import { ClientTag } from '../../entities/Tag';
import useDatabaseCount from '../../hooks/useDatabaseCount';

/**
 * The bars at the foot of the Collections and the Tags panel, like the one of the Sources panel:
 * how many images the collection or tag that is open has, or all of them together when none is open.
 */

export const CollectionCounts = observer(() => {
  const { collectionStore, fileStore, uiStore } = useStore();
  const viewed = collectionStore.collectionList.find((c) => c.isViewed);

  // Every tag that is in a collection, once
  const allTags = Array.from(new Set(collectionStore.collectionList.flatMap((c) => c.tags)));
  const inAnyCollection = useDatabaseCount(
    () => fileStore.countFilesWithAnyTag(allTags),
    viewed === undefined ? allTags.map((tag) => tag.id).join('\n') : undefined,
  );
  // The gallery is showing exactly the images of the open collection
  const count = viewed !== undefined ? fileStore.fileList.length : inAnyCollection;

  const handleClick = () => {
    if (viewed !== undefined || allTags.length === 0) {
      return;
    }
    uiStore.viewAnyOfTags(allTags);
  };

  return (
    <Toolbar id="collection-counts" label="Images in this collection" controls="content-view">
      <ToolbarButton
        text={count ?? '…'}
        icon={IconSet.MEDIA}
        onClick={handleClick}
        pressed={viewed !== undefined}
        tooltip={
          viewed !== undefined ? `Images in ${viewed.name}` : 'All images that are in a collection'
        }
      />
    </Toolbar>
  );
});

export const TagCounts = observer(() => {
  const { fileStore, tagStore, uiStore } = useStore();
  const crits = uiStore.searchCriteriaList;
  // The gallery is showing the images of one or more tags, and nothing else
  const viewedTags =
    fileStore.showsQueryContent &&
    crits.length > 0 &&
    crits.every((crit) => crit instanceof ClientTagSearchCriteria && crit.value !== undefined)
      ? crits
          .map((crit) => tagStore.get((crit as ClientTagSearchCriteria).value as string))
          .filter((tag): tag is ClientTag => tag !== undefined)
      : [];
  const isViewingTags = viewedTags.length > 0;
  const isViewingTagged =
    fileStore.showsQueryContent && crits.length === 1 && isTaggedCriteria(crits[0]);

  const count =
    isViewingTags || isViewingTagged
      ? fileStore.fileList.length
      : Math.max(0, fileStore.numTotalFiles - fileStore.numUntaggedFiles);

  const handleClick = () => {
    if (!isViewingTags && !isViewingTagged) {
      uiStore.replaceSearchCriteria(taggedCriteria());
    }
  };

  return (
    <Toolbar id="tag-counts" label="Images with this tag" controls="content-view">
      <ToolbarButton
        text={count}
        icon={IconSet.MEDIA}
        onClick={handleClick}
        pressed={isViewingTags || isViewingTagged}
        tooltip={
          viewedTags.length === 1
            ? `Images with the tag ${viewedTags[0].name}`
            : isViewingTags
            ? `Images with these ${viewedTags.length} tags`
            : 'All images that have a tag'
        }
      />
    </Toolbar>
  );
});

import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';

import { IconSet } from 'widgets';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../contexts/StoreContext';
import { ClientTagSearchCriteria } from '../../entities/SearchCriteria';
import { ClientTag } from '../../entities/Tag';

/**
 * The bars at the foot of the Collections and the Tags panel, like the one of the Sources panel:
 * how many images the collection or tag that is open has, or all of them together when none is open.
 */

/** Counts in the database, again whenever images are tagged. Undefined while it is not known yet */
function useCountWithAnyTag(tags: readonly ClientTag[], isNeeded: boolean): number | undefined {
  const { fileStore } = useStore();
  const [count, setCount] = useState<number>();
  const key = tags.map((tag) => tag.id).join('\n');
  const { numTotalFiles, numUntaggedFiles, fileListLastModified } = fileStore;
  useEffect(() => {
    if (!isNeeded) {
      return;
    }
    let isCurrent = true;
    const update = () =>
      fileStore
        .countFilesWithAnyTag(tags)
        .then((value) => isCurrent && setCount(value))
        .catch(console.error);
    // Tagging a row of images changes the numbers many times in a moment. And once more a little later:
    // a tag that was just added or removed is written to the database with a delay
    const handles = [window.setTimeout(update, 200), window.setTimeout(update, 2000)];
    return () => {
      isCurrent = false;
      handles.forEach((handle) => window.clearTimeout(handle));
    };
    // The tags are in the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileStore, key, isNeeded, numTotalFiles, numUntaggedFiles, fileListLastModified]);
  return count;
}

export const CollectionCounts = observer(() => {
  const { collectionStore, fileStore, uiStore } = useStore();
  const viewed = collectionStore.collectionList.find((c) => collectionStore.isViewed(c));

  // Every tag that is in a collection, once
  const allTags = Array.from(
    new Set(collectionStore.collectionList.flatMap((c) => collectionStore.getTags(c))),
  );
  const inAnyCollection = useCountWithAnyTag(allTags, viewed === undefined);
  // The gallery is showing exactly the images of the open collection
  const count = viewed !== undefined ? fileStore.fileList.length : inAnyCollection;

  const handleClick = () => {
    if (viewed !== undefined || allTags.length === 0) {
      return;
    }
    runInAction(() => {
      uiStore.searchMatchAny = true;
      uiStore.replaceSearchCriterias(
        allTags.map((tag) => new ClientTagSearchCriteria('tags', tag.id)),
      );
    });
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

/** "Has at least one tag" */
const isTaggedCriteria = (crit: unknown) =>
  crit instanceof ClientTagSearchCriteria && !crit.value && crit.operator === 'notContains';

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
      uiStore.replaceSearchCriteria(new ClientTagSearchCriteria('tags', undefined, 'notContains'));
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

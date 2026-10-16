import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';

import { IconSet } from 'widgets';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../../contexts/StoreContext';
import {
  ClientStringSearchCriteria,
  isFolderCriteria,
  isTaggedCriteria,
  taggedCriteria,
} from '../../../entities/SearchCriteria';
import useDatabaseCount from '../../../hooks/useDatabaseCount';

/**
 * At the foot of the Locations panel: how many images are in the folder that is open (in the whole library
 * when no folder is), and how many of those have a tag. Clicking a number shows those images.
 */
const FolderCounts = observer(() => {
  const { fileStore, uiStore } = useStore();

  const criterias = uiStore.searchCriteriaList;
  const locationCrits = criterias.filter(isFolderCriteria);
  const otherCrits = criterias.filter((crit) => !isFolderCriteria(crit));
  const inFolder = locationCrits.length > 0;
  // "Tagged in A or B" cannot be expressed as a search query, only "tagged in A"
  const canScopeTagged = locationCrits.length <= 1;

  // Counted in the database for the open folders; the library's numbers are kept by the file store
  const paths = locationCrits.map((crit) => crit.value);
  const folderCounts = useDatabaseCount(
    () => fileStore.countFilesInFolders(paths),
    inFolder ? paths.join('\n') : undefined,
  );

  const { numTotalFiles, numUntaggedFiles } = fileStore;
  const total = inFolder ? folderCounts?.[0] : numTotalFiles;
  const tagged = inFolder ? folderCounts?.[1] : numTotalFiles - numUntaggedFiles;
  const percent =
    total !== undefined && tagged !== undefined && total > 0
      ? Math.round((100 * tagged) / total)
      : undefined;

  // The existing criteria are disposed when the search is replaced, so they are re-created
  const copyLocationCrits = () =>
    uiStore.searchCriteriaList
      .filter(isFolderCriteria)
      .map((crit) => new ClientStringSearchCriteria('absolutePath', crit.value, 'startsWith'));

  const handleAllClick = useCallback(() => {
    const locations = copyLocationCrits();
    if (locations.length === 0) {
      fileStore.fetchAllFiles();
    } else {
      uiStore.replaceSearchCriterias(locations);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTaggedClick = useCallback(() => {
    const locations = copyLocationCrits();
    if (locations.length > 1) {
      return;
    }
    // Both the location and "has a tag" must match
    if (uiStore.searchMatchAny) {
      uiStore.toggleSearchMatchAny();
    }
    uiStore.replaceSearchCriterias([...locations, taggedCriteria()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const where = inFolder ? 'in this folder' : 'in your library';
  return (
    <Toolbar id="folder-counts" label="Images in this folder" controls="content-view">
      <ToolbarButton
        text={total ?? '…'}
        icon={IconSet.MEDIA}
        onClick={handleAllClick}
        pressed={
          fileStore.showsAllContent ||
          (fileStore.showsQueryContent && inFolder && otherCrits.length === 0)
        }
        tooltip={`All images ${where}`}
      />
      <ToolbarButton
        text={
          tagged === undefined ? '…' : `${tagged}${percent !== undefined ? ` · ${percent}%` : ''}`
        }
        icon={IconSet.TAG}
        onClick={handleTaggedClick}
        disabled={!canScopeTagged}
        pressed={
          fileStore.showsQueryContent &&
          canScopeTagged &&
          otherCrits.length === 1 &&
          isTaggedCriteria(otherCrits[0])
        }
        tooltip={`Images with a tag ${where}`}
      />
      {fileStore.numMissingFiles > 0 && (
        <ToolbarButton
          text={fileStore.numMissingFiles}
          icon={IconSet.WARNING_FILL}
          onClick={fileStore.fetchMissingFiles}
          pressed={fileStore.showsMissingContent}
          tooltip="View missing images on your system"
        />
      )}
    </Toolbar>
  );
});

export default FolderCounts;

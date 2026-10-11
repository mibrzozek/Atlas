import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';

import { IconSet } from 'widgets';
import { MultiSplitPaneProps } from 'widgets/MultiSplit/MultiSplitPane';
import { Toolbar, ToolbarButton } from 'widgets/toolbar';
import { useStore } from '../../../contexts/StoreContext';
import {
  ClientFileSearchCriteria,
  ClientStringSearchCriteria,
  ClientTagSearchCriteria,
} from '../../../entities/SearchCriteria';
import { useAction } from '../../../hooks/mobx';
import { comboMatches, getKeyCombo, parseKeyCombo } from '../../../hotkeyParser';
import TagsTree from './TagsTree';

// Tooltip info
const enum TooltipInfo {
  AllImages = 'View all images in library',
  AllImagesInLocation = 'View all images in this location',
  Untagged = 'View all untagged images',
  UntaggedInLocation = 'View all untagged images in this location',
  Missing = 'View missing images on your system',
}

/** The folders picked in the Locations panel are searched as "path starts with" criteria */
const isLocationCriteria = (crit: ClientFileSearchCriteria): crit is ClientStringSearchCriteria =>
  crit instanceof ClientStringSearchCriteria &&
  crit.key === 'absolutePath' &&
  crit.operator === 'startsWith';

const isUntaggedCriteria = (crit: ClientFileSearchCriteria) =>
  crit instanceof ClientTagSearchCriteria && !crit.value;

export const OutlinerActionBar = observer(() => {
  const { fileStore, uiStore } = useStore();

  const criterias = uiStore.searchCriteriaList;
  const locationCrits = criterias.filter(isLocationCriteria);
  const otherCrits = criterias.filter((crit) => !isLocationCriteria(crit));
  const inLocation = locationCrits.length > 0;
  // "Untagged in A or B" cannot be expressed as a search query, only "untagged in A"
  const canScopeUntagged = locationCrits.length === 1;

  // The existing criteria are disposed when the search is replaced, so they are re-created
  const copyLocationCrits = () =>
    uiStore.searchCriteriaList
      .filter(isLocationCriteria)
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

  const handleUntaggedClick = useCallback((e: React.MouseEvent) => {
    if (!e.ctrlKey) {
      const locations = copyLocationCrits();
      if (locations.length !== 1) {
        fileStore.fetchUntaggedFiles();
        return;
      }
      // Both the location and the untagged criteria must match
      if (uiStore.searchMatchAny) {
        uiStore.toggleSearchMatchAny();
      }
      uiStore.replaceSearchCriterias([...locations, new ClientTagSearchCriteria('tags')]);
      return;
    }
    // With ctrl key pressed, either add/remove a Untagged criteria based on whether it's already there
    const maybeUntaggedCrit = uiStore.searchCriteriaList.find(
      (crit) => crit instanceof ClientTagSearchCriteria && !crit.value,
    );

    if (maybeUntaggedCrit) {
      uiStore.removeSearchCriteria(maybeUntaggedCrit);
    } else {
      uiStore.addSearchCriteria(new ClientTagSearchCriteria('tags'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Toolbar id="actionbar" label="Action Bar" controls="content-view">
      <ToolbarButton
        text={fileStore.numTotalFiles}
        icon={IconSet.MEDIA}
        onClick={handleAllClick}
        pressed={
          fileStore.showsAllContent ||
          (fileStore.showsQueryContent && inLocation && otherCrits.length === 0)
        }
        tooltip={inLocation ? TooltipInfo.AllImagesInLocation : TooltipInfo.AllImages}
      />
      <ToolbarButton
        text={fileStore.numUntaggedFiles}
        icon={IconSet.TAG_BLANCO}
        onClick={handleUntaggedClick}
        pressed={
          fileStore.showsUntaggedContent ||
          (fileStore.showsQueryContent &&
            canScopeUntagged &&
            otherCrits.length === 1 &&
            isUntaggedCriteria(otherCrits[0]))
        }
        tooltip={canScopeUntagged ? TooltipInfo.UntaggedInLocation : TooltipInfo.Untagged}
      />
      {fileStore.numMissingFiles > 0 && (
        <ToolbarButton
          text={fileStore.numMissingFiles}
          icon={IconSet.WARNING_FILL}
          onClick={fileStore.fetchMissingFiles}
          pressed={fileStore.showsMissingContent}
          tooltip={TooltipInfo.Missing}
        />
      )}
    </Toolbar>
  );
});

const TagsPanel = (props: Partial<MultiSplitPaneProps>) => {
  const { uiStore } = useStore();

  const handleShortcuts = useAction((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input')) {
      return;
    }
    const combo = getKeyCombo(e.nativeEvent);
    const matches = (c: string): boolean => {
      return comboMatches(combo, parseKeyCombo(c));
    };
    const { hotkeyMap } = uiStore;
    if (matches(hotkeyMap.selectAll)) {
      uiStore.selectAllTags();
    } else if (matches(hotkeyMap.deselectAll)) {
      uiStore.clearTagSelection();
    }
  });

  return <TagsTree onKeyDown={handleShortcuts} {...props} />;
};

export default TagsPanel;

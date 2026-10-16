import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef } from 'react';
import useLocalStorage from 'src/frontend/hooks/useLocalStorage';
import MultiSplit from 'widgets/MultiSplit';
import { useStore } from '../../contexts/StoreContext';
import CollectionsPanel from './CollectionsPanel';
import LocationsPanel from './LocationsPanel';
import SavedSearchesPanel from './SavedSearchesPanel';
import TagsPanel from './TagsPanel';
import WorkspacesPanel from './WorkspacesPanel';

const Outliner = () => {
  const { uiStore } = useStore();

  // Would be more consistent to store these in the UIStore,
  // but that would only be needed when the values need to be changed from other places
  // One entry per panel. The keys are renamed whenever a panel is added, as the old lists are shorter
  const [expansion, setExpansion] = useLocalStorage('outliner-expansion-5', [
    true,
    true,
    true,
    true,
    true,
  ]);
  const [heights, setHeights] = useLocalStorage('outliner-heights-5', [0, 0, 0, 0, 0]);

  // The home button collapses all panels
  const collapseRequest = uiStore.outlinerCollapseRequest;
  const handledCollapseRequest = useRef(collapseRequest);
  useEffect(() => {
    if (handledCollapseRequest.current !== collapseRequest) {
      handledCollapseRequest.current = collapseRequest;
      setExpansion([false, false, false, false, false]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseRequest]);

  return (
    <nav id="outliner" aria-expanded={uiStore.isOutlinerOpen}>
      <div id="outliner-content">
        <MultiSplit
          onUpdateExpansion={setExpansion}
          expansion={expansion}
          heights={heights}
          setHeights={setHeights}
        >
          {/* Every panel is only as tall as what is in it; the outliner scrolls when they do not fit */}
          <LocationsPanel fitContent />
          <CollectionsPanel fitContent />
          <WorkspacesPanel fitContent />
          <TagsPanel fitContent />
          <SavedSearchesPanel fitContent />
        </MultiSplit>
      </div>
    </nav>
  );
};

export default observer(Outliner);

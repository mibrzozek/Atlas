import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef } from 'react';
import useLocalStorage from 'src/frontend/hooks/useLocalStorage';
import MultiSplit from 'widgets/MultiSplit';
import { useStore } from '../../contexts/StoreContext';
import CollectionsPanel from './CollectionsPanel';
import LocationsPanel from './LocationsPanel';
import SavedSearchesPanel from './SavedSearchesPanel';
import TagsPanel from './TagsPanel';

const Outliner = () => {
  const { uiStore } = useStore();

  // Would be more consistent to store these in the UIStore,
  // but that would only be needed when the values need to be changed from other places
  // One entry per panel. The keys were renamed when the collections panel was added, as the old lists were shorter
  const [expansion, setExpansion] = useLocalStorage('outliner-expansion-4', [
    true,
    true,
    true,
    true,
  ]);
  const [heights, setHeights] = useLocalStorage('outliner-heights-4', [0, 0, 0, 0]);

  // The home button collapses all panels
  const collapseRequest = uiStore.outlinerCollapseRequest;
  const handledCollapseRequest = useRef(collapseRequest);
  useEffect(() => {
    if (handledCollapseRequest.current !== collapseRequest) {
      handledCollapseRequest.current = collapseRequest;
      setExpansion([false, false, false, false]);
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
          <TagsPanel fitContent />
          <SavedSearchesPanel fitContent />
        </MultiSplit>
      </div>
      <ScanProgress />
    </nav>
  );
};

/**
 * A thin line along the foot of the outliner, while the locations are checked for new and changed images
 * at start-up. It is always there, and only visible while there is something going on.
 */
const ScanProgress = observer(() => {
  const { locationStore } = useStore();
  const progress = locationStore.scanProgress;
  // Halfway into the location that is being looked at; all the way when done, while it fades out
  const fraction = progress !== undefined ? (progress.done + 0.5) / progress.total : 1;
  return (
    <div
      id="scan-progress"
      role="progressbar"
      aria-label="Looking for new images"
      aria-hidden={progress === undefined}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={fraction}
      data-active={progress !== undefined}
    >
      <div className="fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
});

export default observer(Outliner);

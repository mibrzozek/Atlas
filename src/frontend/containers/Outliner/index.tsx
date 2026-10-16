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
      <BackgroundProgress />
    </nav>
  );
};

/**
 * A bar at the foot of the outliner while something is going on in the background: the sources being
 * checked for new and changed images at start-up, or the images of a workspace being prepared. It is
 * always there, and glides in and out of sight; the last words stay while it fades away.
 */
const BackgroundProgress = observer(() => {
  const { locationStore, workspaceStore } = useStore();
  const scan = locationStore.scanProgress;
  const preparing = workspaceStore.preparing?.progress;
  const preparingName = workspaceStore.preparing?.workspace.name;

  const current =
    scan !== undefined
      ? {
          label: 'Looking for new images',
          detail: `${scan.done} of ${scan.total} sources`,
          // Halfway into the source that is being looked at
          fraction: (scan.done + 0.5) / scan.total,
        }
      : preparing !== undefined
      ? {
          label: `Preparing ${preparingName}`,
          detail: `${preparing.done.toLocaleString()} of ${preparing.total.toLocaleString()} images`,
          fraction: preparing.total > 0 ? preparing.done / preparing.total : 0,
        }
      : undefined;
  const last = useRef(current);
  if (current !== undefined) {
    last.current = current;
  }
  const shown = current ?? last.current;

  return (
    <div
      id="background-progress"
      role="progressbar"
      aria-label={shown?.label}
      aria-hidden={current === undefined}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={current?.fraction ?? 1}
      data-active={current !== undefined}
    >
      <div className="background-progress-text">
        <span className="label">{shown?.label}</span>
        <span className="detail">{shown?.detail}</span>
      </div>
      <div className="track">
        {/* All the way when done, while it fades out */}
        <div className="fill" style={{ transform: `scaleX(${current?.fraction ?? 1})` }} />
      </div>
    </div>
  );
});

export default observer(Outliner);

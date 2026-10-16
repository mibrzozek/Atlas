import { observer } from 'mobx-react-lite';
import React from 'react';

import { SCREENSAVER_LIMITS } from 'common/screensaver';
import { Button, GridCell, IconSet, Row, Tag, Toggle } from 'widgets';
import { Callout } from 'widgets/notifications';
import { TagSelector } from '../../components/TagSelector';
import { useStore } from '../../contexts/StoreContext';

/**
 * Which images the screensaver shows: type the name of a tag or a collection and pick it from the list,
 * like tags are picked for an image in the inspector.
 */
const ScreensaverTagPicker = observer(() => {
  const { uiStore, collectionStore, tagStore } = useStore();
  const pickedCollections = uiStore.screensaverPickedCollections;
  const homeTagName = tagStore.homeTag?.name ?? 'Home';

  return (
    <div className="screensaver-tags">
      <span>Show the images of these tags and collections</span>
      <TagSelector
        multiline
        selection={uiStore.screensaverPickedTags}
        onSelect={uiStore.addScreensaverTag}
        onDeselect={uiStore.removeScreensaverTag}
        onClear={uiStore.clearScreensaverSelection}
        placeholder={
          uiStore.isScreensaverUsingHomeGallery ? `Your home gallery (${homeTagName})` : undefined
        }
        extraSelection={pickedCollections.map((collection) => (
          <Tag
            key={collection.id}
            text={collection.name}
            tooltip="Collection"
            onRemove={() => uiStore.removeScreensaverCollection(collection)}
          />
        ))}
        renderExtraOptions={(text, resetTextBox) => {
          const query = text.trim().toLowerCase();
          return collectionStore.sortedByName
            .filter((collection) => collection.name.toLowerCase().includes(query))
            .map((collection) => {
              const selected = pickedCollections.includes(collection);
              return (
                <Row
                  key={`collection-${collection.id}`}
                  id={`screensaver-collection-${collection.id}`}
                  value={collection.name}
                  selected={selected}
                  icon={IconSet.TAG_GROUP}
                  tooltip={collection.tags.map((tag) => tag.name).join(', ')}
                  onClick={() => {
                    if (selected) {
                      uiStore.removeScreensaverCollection(collection);
                    } else {
                      uiStore.addScreensaverCollection(collection);
                    }
                    resetTextBox();
                  }}
                >
                  <GridCell className="tag-option-hint">Collection</GridCell>
                </Row>
              );
            });
        }}
      />
      {uiStore.isScreensaverUsingHomeGallery && (
        <small>Nothing is picked, so your home gallery is shown.</small>
      )}
    </div>
  );
});

export const Screensaver = observer(() => {
  const { uiStore } = useStore();

  const handlePreview = () => {
    // The settings are a window of their own, which would stay in front of the screensaver
    uiStore.closeSettings();
    uiStore.startScreensaver();
  };

  return (
    <div id="screensaver-settings" className="vstack">
      <Callout icon={IconSet.INFO}>
        When you have not used your computer for a while and Atlas is open, it fills your monitors
        with the images of the tags and collections you pick below: your home gallery, unless you
        pick something else. With plenty of images they are laid out like the masonry view you use,
        in rows or in columns, and slowly move through the screen. With only a few, they are shown
        large, a couple at a time; switch on &ldquo;Show one large image per monitor&rdquo; to
        always show them one at a time. Moving the mouse or pressing a key brings you back.
      </Callout>

      <Toggle checked={uiStore.isScreensaverEnabled} onChange={uiStore.toggleScreensaver}>
        Start the screensaver when the computer is not used
      </Toggle>

      <Toggle
        checked={uiStore.isScreensaverOnlyInFront}
        onChange={uiStore.toggleScreensaverOnlyInFront}
      >
        Only while Atlas is the window in front (so it never covers a film in another application)
      </Toggle>

      <ScreensaverTagPicker />

      <label>
        Start after
        <input
          type="number"
          min={SCREENSAVER_LIMITS.idleMinutes.min}
          max={SCREENSAVER_LIMITS.idleMinutes.max}
          step={1}
          value={uiStore.screensaverIdleMinutes}
          disabled={!uiStore.isScreensaverEnabled}
          onChange={(e) => uiStore.setScreensaverIdleMinutes(e.target.valueAsNumber)}
        />
        minutes without using the mouse or keyboard
      </label>

      <label>
        Move to the next image every
        <input
          type="number"
          min={SCREENSAVER_LIMITS.secondsPerImage.min}
          max={SCREENSAVER_LIMITS.secondsPerImage.max}
          step={1}
          value={uiStore.screensaverSecondsPerImage}
          onChange={(e) => uiStore.setScreensaverSecondsPerImage(e.target.valueAsNumber)}
        />
        seconds
      </label>

      <Toggle
        checked={uiStore.isScreensaverSingleImage}
        onChange={uiStore.toggleScreensaverSingleImage}
      >
        Show one large image per monitor
      </Toggle>

      <Toggle
        checked={uiStore.isScreensaverOnAllMonitors}
        onChange={uiStore.toggleScreensaverOnAllMonitors}
      >
        Use all monitors
      </Toggle>

      <div>
        <Button text="Start it now" onClick={handlePreview} styling="outlined" />
      </div>
    </div>
  );
});

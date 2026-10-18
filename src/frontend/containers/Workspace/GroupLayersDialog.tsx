import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';

/**
 * Naming the group the selected layers become (Ctrl+G, or Group layers in the layers panel). The group is
 * made locked: its layers are selected and moved as one, until its lock in the layers panel is opened.
 */
export const GroupLayersDialog = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const { uiStore } = useStore();
  const count = workspace.selection.size;
  const [name, setName] = useState(`Group ${workspace.groupsInUse.length + 1}`);
  const nameInput = useRef<HTMLInputElement>(null);
  // Ready to be typed over: `autoFocus` is lost when the dialog opens as a modal after it
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameInput.current?.select());
    return () => cancelAnimationFrame(frame);
  }, []);
  const isNamed = name.trim().length > 0;

  const group = () => {
    if (isNamed) {
      workspace.groupSelection(name);
      uiStore.closeLayerGrouping();
    }
  };

  return (
    <Dialog
      open
      title="Group layers"
      icon={IconSet.LAYERS}
      onCancel={uiStore.closeLayerGrouping}
      describedby="group-layers-info"
    >
      <form
        className="workspace-dialog"
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          group();
        }}
      >
        <p id="group-layers-info">
          {count.toLocaleString()} layers, locked together: they are selected and moved as one until
          the group is unlocked in the layers panel.
        </p>
        <label className="workspace-dialog-field">
          <span>Name</span>
          <div className="workspace-dialog-input" data-invalid={!isNamed}>
            <input
              ref={nameInput}
              spellCheck={false}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </label>
        <div className="dialog-actions">
          <Button text="Cancel" onClick={uiStore.closeLayerGrouping} />
          <Button text="Group" styling="filled" onClick={group} disabled={!isNamed} />
        </div>
      </form>
    </Dialog>
  );
});

import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { fileNameOf } from 'common/export';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { RendererMessenger } from '../../../ipc/renderer';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import {
  PICTURE_EXTENSIONS,
  pictureAreaName,
  PictureFormat,
  saveWorkspacePicture,
} from './workspacePicture';

const FORMATS: { format: PictureFormat; name: string; detail: string }[] = [
  { format: 'png', name: 'PNG', detail: 'Without loss, larger' },
  { format: 'jpeg', name: 'JPEG', detail: 'Much smaller, for sharing' },
];

/** The folder pictures were saved in last, where the folder dialog opens the next time */
const LAST_FOLDER_KEY = 'Atlas_WorkspacePictureFolder';

function lastFolder(): string | undefined {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saving a workspace as a picture: under a name of the user's own (the workspace's to begin with), as PNG
 * or JPEG, in a folder picked after. Never over another file: a taken name gets a number.
 */
export const SavePictureDialog = observer(
  ({ workspace, onClose }: { workspace: ClientWorkspace; onClose: () => void }) => {
    const { workspaceStore } = useStore();
    const [name, setName] = useState(workspace.name);
    const [format, setFormat] = useState<PictureFormat>('png');
    const fileName = fileNameOf(name);
    const nameInput = useRef<HTMLInputElement>(null);
    // The name ready to be typed over: `autoFocus` is lost when the dialog opens as a modal after it
    useEffect(() => {
      const frame = requestAnimationFrame(() => nameInput.current?.select());
      return () => cancelAnimationFrame(frame);
    }, []);

    const save = async () => {
      const images = workspaceStore.imagesOf(workspace);
      const surface = workspaceStore.surface;
      if (fileName === '' || images === undefined || surface === undefined) {
        return;
      }
      const { filePaths } = await RendererMessenger.showOpenDialog({
        title: `Choose a folder for "${fileName}.${PICTURE_EXTENSIONS[format]}"`,
        buttonLabel: 'Save here',
        defaultPath: lastFolder(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (filePaths.length === 0) {
        return;
      }
      try {
        localStorage.setItem(LAST_FOLDER_KEY, filePaths[0]);
      } catch {
        // Only where the dialog opens next time
      }
      onClose();
      saveWorkspacePicture(workspace, images.sources, surface.viewport, {
        name: fileName,
        format,
        folder: filePaths[0],
      });
    };

    return (
      <Dialog
        open
        title="Save as picture"
        icon={IconSet.EXPORT}
        onCancel={onClose}
        describedby="save-picture-info"
      >
        <form
          className="workspace-dialog"
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <p id="save-picture-info">
            {pictureAreaName(workspace)}, at the full resolution of its photos.
          </p>

          <label className="workspace-dialog-field">
            <span>Name</span>
            {/* The name and its extension as one field: the extension follows the format */}
            <div className="workspace-dialog-input" data-invalid={fileName === ''}>
              <input
                ref={nameInput}
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <span>.{PICTURE_EXTENSIONS[format]}</span>
            </div>
          </label>

          <div className="workspace-dialog-field" role="radiogroup" aria-label="Format">
            <span>Format</span>
            <div className="save-picture-formats">
              {FORMATS.map((option) => (
                <label key={option.format} data-checked={option.format === format}>
                  <input
                    type="radio"
                    name="save-picture-format"
                    value={option.format}
                    checked={option.format === format}
                    onChange={() => setFormat(option.format)}
                  />
                  <strong>{option.name}</strong>
                  <small>{option.detail}</small>
                </label>
              ))}
            </div>
          </div>

          <div className="dialog-actions">
            <Button text="Cancel" onClick={onClose} />
            <Button text="Save…" styling="filled" onClick={save} disabled={fileName === ''} />
          </div>
        </form>
      </Dialog>
    );
  },
);

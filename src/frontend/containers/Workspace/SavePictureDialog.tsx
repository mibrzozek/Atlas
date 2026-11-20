import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { fileNameOf } from 'common/export';
import { nextFileName, nextFileNameIn } from 'common/file-naming';
import { folderDateOf } from 'common/folder-series';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace } from '../../entities/Workspace';
import {
  chooseSaveFolder,
  existingFolder,
  PICTURE_FOLDER_KEY,
  rememberFolder,
  SavesTo,
  storedFolder,
} from './SaveFolder';
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

/**
 * Saving a workspace as a picture: under a name of the user's own (the workspace's to begin with), as PNG
 * or JPEG, in the folder the workspace saves to, or else one picked after. Never over another file: a taken
 * name gets a number. A workspace that names its files gets the next of its names in the folder, unless a
 * name is typed.
 */
export const SavePictureDialog = observer(
  ({ workspace, onClose }: { workspace: ClientWorkspace; onClose: () => void }) => {
    const { workspaceStore } = useStore();
    const naming = workspace.fileNaming;
    // Before a folder is known, the first name the naming gives
    const [hint, setHint] = useState(() =>
      naming !== undefined ? nextFileName(naming, [], folderDateOf(new Date())) : workspace.name,
    );
    const [typedName, setTypedName] = useState<string>();
    const name = typedName ?? hint;
    const [format, setFormat] = useState<PictureFormat>('png');
    const fileName = fileNameOf(name);
    const nameInput = useRef<HTMLInputElement>(null);
    // The folder the picture goes to, once it is known: the workspace's own, if it is still there
    const [folder, setFolder] = useState<string>();
    useEffect(() => {
      existingFolder(workspace.saveFolder).then((saved) => {
        if (saved !== undefined) {
          setFolder((current) => current ?? saved);
        }
      });
    }, [workspace]);
    // The next name in that folder (or the one pictures were saved to last), shown as the name to begin with
    useEffect(() => {
      const target = folder ?? storedFolder(PICTURE_FOLDER_KEY);
      if (naming !== undefined && target !== undefined) {
        nextFileNameIn(naming, target).then(setHint);
      }
    }, [naming, folder]);
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
      // Into the folder it saves to, else one picked now
      const target =
        folder ??
        (await chooseSaveFolder(
          `Choose a folder for "${fileName}.${PICTURE_EXTENSIONS[format]}"`,
          storedFolder(PICTURE_FOLDER_KEY),
        ));
      if (target === undefined) {
        return;
      }
      rememberFolder(PICTURE_FOLDER_KEY, target);
      // The next name in the folder, unless the user named the picture
      const picked =
        naming !== undefined && typedName === undefined
          ? await nextFileNameIn(naming, target)
          : fileName;
      onClose();
      saveWorkspacePicture(workspace, images.sources, surface.viewport, {
        name: picked,
        format,
        folder: target,
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
                onChange={(event) => setTypedName(event.target.value)}
              />
              <span>.{PICTURE_EXTENSIONS[format]}</span>
            </div>
          </label>

          {folder !== undefined && (
            <SavesTo
              folder={folder}
              title={`Choose a folder for "${fileName}.${PICTURE_EXTENSIONS[format]}"`}
              onChange={setFolder}
            />
          )}

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

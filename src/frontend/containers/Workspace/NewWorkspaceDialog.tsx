import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { fileNameOf } from 'common/export';
import { DateStyle, FileNaming, nextFileName } from 'common/file-naming';
import {
  folderDateOf,
  folderSeriesNames,
  formatFolderDate,
  FolderDateOrder,
} from 'common/folder-series';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { galleryCorner } from '../ContentView/utils';
import { useStore } from '../../contexts/StoreContext';
import {
  DATE_ORDERS,
  Field,
  NamingMode,
  NamingModeSwitch,
  NumberStyleSelect,
  SEPARATORS,
} from '../NamingFields';
import { chooseSaveFolder, lastSaveFolder } from './SaveFolder';

const MODE_STORAGE_KEY = 'workspace-naming-mode';
const DATE_STYLE_STORAGE_KEY = 'workspace-naming-date-style';
const DEFAULT_DATE_STYLE: DateStyle = {
  datePosition: 'before',
  order: 'YMD',
  dateSeparator: '-',
  nameSeparator: '_',
};

function storedMode(): NamingMode {
  return localStorage.getItem(MODE_STORAGE_KEY) === 'date' ? 'date' : 'pattern';
}

function storedDateStyle(): DateStyle {
  try {
    return {
      ...DEFAULT_DATE_STYLE,
      ...JSON.parse(localStorage.getItem(DATE_STYLE_STORAGE_KEY) ?? '{}'),
    };
  } catch {
    return DEFAULT_DATE_STYLE;
  }
}

/**
 * The name of a new workspace, the folder its pictures and videos are saved to, and how they are named. The
 * prefix and the date's name follow the name until they are typed over. Only the mode and the date style are
 * remembered: the name and the folder are the workspace's own.
 */
const NewWorkspaceForm = observer(() => {
  const { uiStore, workspaceStore } = useStore();
  const [name, setName] = useState(() => workspaceStore.nameForNewWorkspace());
  // Where the files are saved to; not chosen, they are asked for when saved
  const [saveFolder, setSaveFolder] = useState<string | undefined>(lastSaveFolder);
  const [mode, setModeState] = useState<NamingMode>(storedMode);
  const [prefix, setPrefix] = useState<string>();
  const [digits, setDigits] = useState('3');
  const [suffix, setSuffix] = useState('');
  const [dateName, setDateName] = useState<string>();
  const [dateStyle, setDateStyle] = useState(storedDateStyle);
  const nameInput = useRef<HTMLInputElement>(null);
  // The name ready to be typed over, as in the other dialogs
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameInput.current?.select());
    return () => cancelAnimationFrame(frame);
  }, []);

  // The folder the folder creator made last is saved to, once it is closed (it is open on top of this one)
  useEffect(
    () =>
      reaction(
        () => uiStore.isFolderCreatorOpen,
        (isOpen) => {
          if (!isOpen && uiStore.lastCreatedFolder !== undefined) {
            setSaveFolder(uiStore.lastCreatedFolder);
          }
        },
      ),
    [uiStore],
  );

  const browse = async () => {
    const picked = await chooseSaveFolder(
      'Choose where the files of the workspace are saved',
      saveFolder,
    );
    if (picked !== undefined) {
      setSaveFolder(picked);
    }
  };

  const setMode = (newMode: NamingMode) => {
    setModeState(newMode);
    localStorage.setItem(MODE_STORAGE_KEY, newMode);
  };
  const updateDateStyle = (update: Partial<DateStyle>) => {
    const newStyle = { ...dateStyle, ...update };
    setDateStyle(newStyle);
    localStorage.setItem(DATE_STYLE_STORAGE_KEY, JSON.stringify(newStyle));
  };

  const prefixValue = prefix ?? (name === '' ? '' : `${name}_`);
  const dateNameValue = dateName ?? name;
  const naming: FileNaming =
    mode === 'pattern'
      ? { mode: 'pattern', prefix: prefixValue, digits: parseInt(digits, 10), suffix }
      : { mode: 'date', name: dateNameValue, ...dateStyle };
  const today = folderDateOf(new Date());
  const canCreate = name.trim() !== '';

  const create = () => {
    if (!canCreate) {
      return;
    }
    workspaceStore.createFromLibrary(name.trim(), { fileNaming: naming, saveFolder });
    uiStore.closeNewWorkspace();
  };

  const preview =
    naming.mode === 'pattern'
      ? `${folderSeriesNames(naming.prefix, 1, naming.digits, naming.suffix, 2)
          .map(fileNameOf)
          .join(', ')} …`
      : nextFileName(naming, [], today);

  return (
    <form
      className="workspace-dialog new-workspace-dialog"
      method="dialog"
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // Enter in one of the fields creates the workspace, like the button
        if (event.key === 'Enter' && (event.target as Element).tagName === 'INPUT') {
          event.preventDefault();
          create();
        }
      }}
    >
      <label className="workspace-dialog-field">
        <span>Name</span>
        <input
          ref={nameInput}
          className="input"
          type="text"
          spellCheck={false}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <div className="workspace-dialog-field">
        <span>Save to</span>
        <div className="new-workspace-save-to">
          <div className="workspace-dialog-input" data-empty={saveFolder === undefined}>
            <span data-tooltip={saveFolder}>{saveFolder ?? 'Asked when saving'}</span>
          </div>
          <Button
            styling="outlined"
            icon={IconSet.FOLDER_OPEN}
            text="Browse…"
            tooltip="Choose the folder the files are saved to"
            onClick={browse}
          />
          <Button
            styling="outlined"
            icon={IconSet.FOLDER_CLOSE_ADD}
            text="Create folder…"
            tooltip="Create folders, starting in the folder the files are saved to"
            onClick={() => uiStore.openFolderCreator(saveFolder)}
          />
        </div>
      </div>

      <div className="workspace-dialog-field">
        <span>Name saved files</span>
        <NamingModeSwitch label="Name saved files" mode={mode} onChange={setMode} />
      </div>

      {mode === 'pattern' ? (
        <fieldset className="folder-creator-fields" data-mode="pattern">
          <Field label="Prefix" hint="Text in front of the number">
            <input
              className="input"
              type="text"
              spellCheck={false}
              value={prefixValue}
              onChange={(event) => setPrefix(event.target.value)}
            />
          </Field>
          <Field label="Number style" hint="Whether short numbers get zeros in front">
            <NumberStyleSelect value={digits} onChange={setDigits} />
          </Field>
          <Field label="Suffix" hint="Text behind the number">
            <input
              className="input"
              type="text"
              spellCheck={false}
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
            />
          </Field>
        </fieldset>
      ) : (
        <fieldset className="folder-creator-fields" data-mode="date">
          <Field label="Name" hint="Leave empty to name the files by date only">
            <input
              className="input"
              type="text"
              spellCheck={false}
              value={dateNameValue}
              onChange={(event) => setDateName(event.target.value)}
            />
          </Field>
          <Field label="Date goes">
            <select
              value={dateStyle.datePosition}
              onChange={(event) =>
                updateDateStyle({ datePosition: event.target.value as DateStyle['datePosition'] })
              }
            >
              <option value="before">Before the name</option>
              <option value="after">After the name</option>
            </select>
          </Field>
          <Field label="Between name and date">
            <select
              value={dateStyle.nameSeparator}
              onChange={(event) => updateDateStyle({ nameSeparator: event.target.value })}
            >
              {SEPARATORS.map(([value, label]) => (
                <option key={label} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date style">
            <select
              value={dateStyle.order}
              onChange={(event) =>
                updateDateStyle({ order: event.target.value as FolderDateOrder })
              }
            >
              {DATE_ORDERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {`${formatFolderDate(today, value, dateStyle.dateSeparator)} (${label})`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Inside the date">
            <select
              value={dateStyle.dateSeparator}
              onChange={(event) => updateDateStyle({ dateSeparator: event.target.value })}
            >
              {SEPARATORS.map(([value, label]) => (
                <option key={label} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
      )}

      <p className="folder-creator-preview">
        Files will be named: <b>{preview}</b>
      </p>

      <div className="dialog-actions">
        <Button text="Cancel" onClick={uiStore.closeNewWorkspace} />
        <Button
          text="Create workspace"
          styling="filled"
          icon={IconSet.ADD}
          onClick={create}
          disabled={!canCreate}
        />
      </div>
    </form>
  );
});

/**
 * A new workspace of the images the Library shows: asked for its name, and how the pictures and videos
 * saved from it are named. Escape cancels; Enter in a field creates it.
 */
const NewWorkspaceDialog = observer(() => {
  const { uiStore } = useStore();
  return (
    <Dialog
      open={uiStore.isNewWorkspaceOpen}
      title="New workspace"
      icon={IconSet.WORKSPACE}
      onCancel={uiStore.closeNewWorkspace}
      // Where the folder creator opens too
      isMovable
      placeAt={galleryCorner}
    >
      {/* Mounted only while open, so that it starts from the name it would be given every time */}
      {uiStore.isNewWorkspaceOpen && <NewWorkspaceForm />}
    </Dialog>
  );
});

export default NewWorkspaceDialog;

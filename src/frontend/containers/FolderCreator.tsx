import { shell } from 'electron';
import { opendir } from 'fs/promises';
import fse from 'fs-extra';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import SysPath from 'path';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { besideLeft } from 'common/core';
import {
  FolderDate,
  FolderDateOrder,
  FolderDateStep,
  FolderSeries,
  MAX_FOLDERS_PER_BATCH,
  addToFolderDate,
  dateFolderNames,
  detectFolderSeries,
  folderDateOf,
  formatFolderDate,
  folderSeriesNames,
  invalidFolderNameReason,
} from 'common/folder-series';
import { createFolders } from 'common/folder-create';
import { RendererMessenger } from 'src/ipc/renderer';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import Tree, { ITreeItem, createBranchOnKeyDown, createLeafOnKeyDown } from 'widgets/tree';
import { useStore } from '../contexts/StoreContext';
import { ClientStringSearchCriteria } from '../entities/SearchCriteria';
import RootStore from '../stores/RootStore';
import { galleryCorner } from './ContentView/utils';
import {
  DATE_ORDERS,
  Field,
  NamingMode,
  NamingModeSwitch,
  NumberStyleSelect,
  SEPARATORS,
} from './NamingFields';

const LAST_DIRECTORY_STORAGE_KEY = 'folder-creator-directory';

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface Listing {
  directory: string;
  /** Lower-cased names of everything in the directory, files included: none of them can be used */
  taken: Set<string>;
  series: FolderSeries | undefined;
}

/**
 * Reads the names in the directory: files are not opened, nothing is changed.
 * The result only lives in the dialog while it is open. It is not saved to the database or anywhere else.
 */
async function listDirectory(directory: string): Promise<Listing> {
  const entries = await fse.readdir(directory, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(naturalOrder.compare);
  return {
    directory,
    taken: new Set(entries.map((entry) => entry.name.toLowerCase())),
    series: detectFolderSeries(folders),
  };
}

/** A folder in the tree: whether it holds folders of its own decides whether it gets a caret */
interface FolderNode {
  path: string;
  name: string;
  hasFolders: boolean;
}

/** Whether a folder holds another folder: names only, read until the first folder is found */
async function hasSubfolder(path: string): Promise<boolean> {
  try {
    // Leaving the loop early closes the folder again
    for await (const entry of await opendir(path)) {
      if (entry.isDirectory()) {
        return true;
      }
    }
  } catch {
    // A folder that cannot be read has nothing to open
  }
  return false;
}

/** The folders in a folder, in natural order. Only names are read, nothing is changed */
async function subfoldersOf(path: string): Promise<FolderNode[]> {
  const entries = await fse.readdir(path, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(naturalOrder.compare);
  return Promise.all(
    names.map(async (name) => {
      const child = SysPath.join(path, name);
      return { path: child, name, hasFolders: await hasSubfolder(child) };
    }),
  );
}

interface FolderTreeData {
  /** Where the new folders go */
  selected: string | undefined;
  expanded: ReadonlySet<string>;
  select: (path: string) => void;
  toggle: (path: string) => void;
}

const isFolderExpanded = (node: FolderNode, tree: FolderTreeData) => tree.expanded.has(node.path);
const isFolderSelected = (node: FolderNode, tree: FolderTreeData) => node.path === tree.selected;
const toggleFolder = (node: FolderNode, tree: FolderTreeData) => tree.toggle(node.path);
const selectFolder = (node: FolderNode, tree: FolderTreeData) => tree.select(node.path);

const FolderLabel = ({
  nodeData,
  treeData,
}: {
  nodeData: FolderNode;
  treeData: FolderTreeData;
}) => (
  <div
    className="tree-content-label"
    data-tooltip="Create the new folders in here"
    onClick={() => treeData.select(nodeData.path)}
  >
    {IconSet.FOLDER_CLOSE}
    <span>{nodeData.name}</span>
  </div>
);

/** A folder and, once it was opened, the folders in it; until they are read, a row that says so */
function folderItem(node: FolderNode, read: ReadonlyMap<string, FolderNode[]>): ITreeItem {
  const subfolders = read.get(node.path);
  return {
    id: node.path,
    label: FolderLabel,
    nodeData: node,
    isExpanded: isFolderExpanded,
    isSelected: isFolderSelected,
    children:
      subfolders !== undefined
        ? subfolders.map((subfolder) => folderItem(subfolder, read))
        : node.hasFolders
        ? [
            {
              id: node.path + SysPath.sep,
              label: 'Loading…',
              nodeData: node,
              isExpanded: () => false,
              children: [],
            },
          ]
        : [],
  };
}

/**
 * The folder it was opened in, else the folder being looked at in the gallery, else the one used last time,
 * else the first location
 */
function initialDirectory(
  { uiStore, locationStore }: RootStore,
  startDirectory?: string,
): string | undefined {
  if (startDirectory !== undefined) {
    return startDirectory;
  }
  return runInAction(() => {
    const locationCrit = uiStore.searchCriteriaList.find(
      (crit): crit is ClientStringSearchCriteria =>
        crit instanceof ClientStringSearchCriteria &&
        crit.key === 'absolutePath' &&
        crit.operator === 'startsWith',
    );
    if (locationCrit) {
      // Its value has a trailing separator; path.resolve drops it, except for a drive root
      return SysPath.resolve(locationCrit.value);
    }
    return (
      localStorage.getItem(LAST_DIRECTORY_STORAGE_KEY) ??
      (locationStore.locationList.length > 0 ? locationStore.locationList[0].path : undefined)
    );
  });
}

const parseWholeNumber = (text: string): number | undefined =>
  /^\d{1,15}$/.test(text.trim()) ? parseInt(text.trim(), 10) : undefined;

const MODE_STORAGE_KEY = 'folder-creator-mode';

/** How folders are named by date. Remembered, as it is usually the same every time */
interface DateSettings {
  name: string;
  datePosition: 'before' | 'after';
  order: FolderDateOrder;
  dateSeparator: string;
  nameSeparator: string;
  step: FolderDateStep;
}
const DATE_SETTINGS_STORAGE_KEY = 'folder-creator-date-settings';
const DEFAULT_DATE_SETTINGS: DateSettings = {
  name: '',
  datePosition: 'before',
  order: 'YMD',
  dateSeparator: '-',
  nameSeparator: '_',
  step: 'day',
};

function storedDateSettings(): DateSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(DATE_SETTINGS_STORAGE_KEY) ?? '{}');
    return { ...DEFAULT_DATE_SETTINGS, ...stored };
  } catch {
    return DEFAULT_DATE_SETTINGS;
  }
}

// The value of an <input type="date"> is always YYYY-MM-DD
const toDateInputValue = (date: FolderDate) => formatFolderDate({ ...date }, 'YMD', '-');

function parseDateInputValue(value: string): FolderDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) }
    : undefined;
}

const today = (): FolderDate => folderDateOf(new Date());

const FolderCreatorForm = observer(({ startDirectory }: { startDirectory?: string }) => {
  const rootStore = useStore();
  const { uiStore, locationStore } = rootStore;

  const [listing, setListing] = useState<Listing>();
  // The folder the tree starts from (a source, or one browsed to), and the one selected in it: where
  // the new folders go, and whose folders the suggested pattern continues
  const [root, setRoot] = useState<string | undefined>(() =>
    initialDirectory(rootStore, startDirectory),
  );
  const [directory, setDirectory] = useState<string | undefined>(root);
  const [readError, setReadError] = useState<string>();
  // The folders of every folder opened in the tree so far, and which are open
  const [read, setRead] = useState<ReadonlyMap<string, FolderNode[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [start, setStart] = useState('1');
  const [digits, setDigits] = useState('1');
  const [count, setCount] = useState('1');

  const [mode, setModeState] = useState<NamingMode>(() =>
    localStorage.getItem(MODE_STORAGE_KEY) === 'date' ? 'date' : 'pattern',
  );
  const setMode = (newMode: NamingMode) => {
    setModeState(newMode);
    localStorage.setItem(MODE_STORAGE_KEY, newMode);
  };
  const [dateSettings, setDateSettings] = useState(storedDateSettings);
  const updateDateSettings = (update: Partial<DateSettings>) => {
    const newSettings = { ...dateSettings, ...update };
    setDateSettings(newSettings);
    localStorage.setItem(DATE_SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };
  const [dateStart, setDateStart] = useState(() => toDateInputValue(today()));

  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ message: string; isError: boolean }>();
  const countInput = useRef<HTMLInputElement>(null);

  // Open a directory: read what is in there, and continue the numbering its folders already follow
  const loadCounter = useRef(0);
  const load = useCallback(async (dir: string) => {
    const loadId = ++loadCounter.current;
    try {
      const newListing = await listDirectory(dir);
      if (loadId !== loadCounter.current) {
        return;
      }
      const { series } = newListing;
      setListing(newListing);
      setReadError(undefined);
      setPrefix(series?.prefix ?? '');
      setSuffix(series?.suffix ?? '');
      setStart(String(series?.next ?? 1));
      setDigits(String(Math.max(1, series?.digits ?? 1)));
      localStorage.setItem(LAST_DIRECTORY_STORAGE_KEY, dir);
    } catch (e) {
      if (loadId !== loadCounter.current) {
        return;
      }
      console.error('Could not read folder', dir, e);
      setListing(undefined);
      setReadError(`This folder cannot be opened${e instanceof Error ? `: ${e.message}` : ''}`);
    }
  }, []);

  useEffect(() => {
    if (directory !== undefined) {
      load(directory);
    }
  }, [directory, load]);

  /** Reads the folders of a folder in the tree (again) */
  const readFolders = useCallback((dir: string) => {
    subfoldersOf(dir)
      .catch(() => [])
      .then((subfolders) => setRead((before) => new Map(before).set(dir, subfolders)));
  }, []);

  // A new folder to start from: the tree begins there, opened
  useEffect(() => {
    if (root !== undefined) {
      setRead(new Map());
      setExpanded(new Set([root]));
      readFolders(root);
    }
  }, [root, readFolders]);

  /** Starts the tree from a folder, which is also selected */
  const open = useCallback((dir: string) => {
    setResult(undefined);
    setRoot(dir);
    setDirectory(dir);
  }, []);

  const treeData = useMemo(
    (): FolderTreeData => ({
      selected: directory,
      expanded,
      select: (path) => {
        setResult(undefined);
        setDirectory(path);
      },
      toggle: (path) => {
        const isOpening = !expanded.has(path);
        const now = new Set(expanded);
        if (isOpening) {
          now.add(path);
          if (!read.has(path)) {
            readFolders(path);
          }
        } else {
          now.delete(path);
        }
        setExpanded(now);
      },
    }),
    [directory, expanded, read, readFolders],
  );

  const browse = useCallback(async () => {
    try {
      const { filePaths } = await RendererMessenger.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: directory,
      });
      if (filePaths.length > 0) {
        open(filePaths[0]);
      }
    } catch (e) {
      console.error(e);
    }
  }, [directory, open]);

  const parent = directory !== undefined ? SysPath.dirname(directory) : undefined;
  const hasParent = parent !== undefined && parent !== directory;

  // The first row of the tree: the folder it starts from, by the name of its source if it is one
  const rootNode = useMemo((): FolderNode | undefined => {
    if (root === undefined) {
      return undefined;
    }
    const source = runInAction(() =>
      locationStore.locationList.find((location) => location.path === root),
    );
    return { path: root, name: source?.name ?? (SysPath.basename(root) || root), hasFolders: true };
  }, [root, locationStore]);

  // What would be created
  const startNumber = parseWholeNumber(start);
  const digitCount = parseWholeNumber(digits);
  const folderCount = parseWholeNumber(count);
  const firstDate = parseDateInputValue(dateStart);

  const { names, problem } = useMemo((): { names: string[]; problem?: string } => {
    if (listing === undefined) {
      return { names: [] };
    }
    if (folderCount === undefined || folderCount < 1 || folderCount > MAX_FOLDERS_PER_BATCH) {
      return {
        names: [],
        problem: `How many: enter a number from 1 to ${MAX_FOLDERS_PER_BATCH}`,
      };
    }
    let names: string[];
    if (mode === 'pattern') {
      if (startNumber === undefined) {
        return { names: [], problem: 'Start at: enter a whole number' };
      }
      names = folderSeriesNames(prefix, startNumber, digitCount ?? 1, suffix, folderCount);
    } else {
      if (firstDate === undefined) {
        return { names: [], problem: 'First date: choose a date' };
      }
      names = dateFolderNames({ ...dateSettings, start: firstDate, count: folderCount });
    }
    const invalid =
      invalidFolderNameReason(names[0]) ?? invalidFolderNameReason(names[names.length - 1]);
    if (invalid) {
      return { names, problem: invalid };
    }
    const existing = names.filter((name) => listing.taken.has(name.toLowerCase()));
    if (existing.length > 0) {
      const shown = existing.slice(0, 3).join(', ') + (existing.length > 3 ? ', …' : '');
      return {
        names,
        problem: `Already exists here: ${shown}. Existing folders are never replaced.`,
      };
    }
    return { names };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    listing,
    mode,
    prefix,
    suffix,
    startNumber,
    digitCount,
    folderCount,
    dateSettings,
    dateStart,
  ]);

  const canCreate = listing !== undefined && names.length > 0 && !problem && !isCreating;

  const create = useCallback(async () => {
    if (!canCreate) {
      return;
    }
    const dir = listing.directory;
    setIsCreating(true);
    setResult(undefined);
    // The only thing that is written: new, empty folders. See createFolders for what it guarantees
    const { created, error } = await createFolders(dir, names);
    if (error === undefined) {
      setResult({
        message:
          created.length === 1
            ? `Created ${created[0]}`
            : `Created ${created.length} folders: ${created[0]} … ${created[created.length - 1]}`,
        isError: false,
      });
    } else {
      console.error('Could not create folders', error);
      setResult({
        message: `Stopped after creating ${created.length} of ${names.length} folders: ${error.message}`,
        isError: true,
      });
    }
    setIsCreating(false);

    // Show the new folders: here, and in the tree of the location they are in.
    // The next batch continues where this one ended: load() does that for the numbers
    if (mode === 'date' && firstDate !== undefined && created.length === names.length) {
      setDateStart(toDateInputValue(addToFolderDate(firstDate, dateSettings.step, names.length)));
    }
    await load(dir);
    countInput.current?.focus();
    if (created.length > 0) {
      // The last one made is where a new workspace saves to, once this is closed (NewWorkspaceDialog)
      uiStore.lastCreatedFolder = SysPath.join(dir, created[created.length - 1]);
      // The new folders in the tree: under the folder, opened, and its caret if it had none
      readFolders(dir);
      setExpanded((before) => new Set(before).add(dir));
      const parentDir = SysPath.dirname(dir);
      if (read.has(parentDir)) {
        readFolders(parentDir);
      }
      const location = runInAction(() =>
        locationStore.locationList.find(
          (loc) => dir === loc.path || dir.startsWith(loc.path + SysPath.sep),
        ),
      );
      location?.refreshSublocations().catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, listing, load, locationStore, names, mode, dateStart, dateSettings.step, read]);

  const { series } = listing ?? {};
  const seriesHint =
    listing === undefined
      ? undefined
      : series === undefined
      ? 'No numbered folders here yet: choose a prefix or suffix to start a series.'
      : `Continues the ${series.size} numbered folder${
          series.size === 1 ? '' : 's'
        } here: the last one is ${series.last}.`;

  const countField = (
    <Field label="How many" hint="The number of folders to create">
      <input
        ref={countInput}
        className="input folder-creator-count"
        type="number"
        min={1}
        max={MAX_FOLDERS_PER_BATCH}
        step={1}
        value={count}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setCount(e.target.value)}
      />
    </Field>
  );

  const preview =
    names.length <= 8
      ? names.join(', ')
      : `${names.slice(0, 4).join(', ')} … ${names[names.length - 1]}`;

  return (
    <form
      id="folder-creator"
      method="dialog"
      onSubmit={(e) => {
        e.preventDefault();
      }}
      onKeyDown={(e) => {
        // Enter in one of the fields creates the folders, like the button
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          create();
        }
      }}
    >
      <div className="folder-creator-path">
        <span className="folder-creator-directory" data-tooltip={directory}>
          {directory ?? 'Choose the folder to create the new folders in'}
        </span>
        <Button
          styling="outlined"
          icon={IconSet.ARROW_UP}
          text="Up"
          tooltip="Open the folder this one is in"
          onClick={() => parent !== undefined && open(parent)}
          disabled={!hasParent}
        />
        <Button styling="outlined" icon={IconSet.FOLDER_OPEN} text="Browse…" onClick={browse} />
      </div>

      {locationStore.locationList.length > 0 && (
        <div className="folder-creator-locations">
          <span>Sources</span>
          {locationStore.locationList.map((location) => (
            <button
              key={location.id}
              type="button"
              className="btn-minimal"
              aria-pressed={location.path === root}
              onClick={() => open(location.path)}
            >
              {location.name}
            </button>
          ))}
        </div>
      )}

      {readError !== undefined ? (
        <p className="folder-creator-error">{readError}</p>
      ) : (
        rootNode !== undefined && (
          <Tree
            className="folder-creator-list"
            children={[folderItem(rootNode, read)]}
            treeData={treeData}
            toggleExpansion={toggleFolder}
            onBranchKeyDown={(event, node, tree) =>
              createBranchOnKeyDown(event, node, tree, isFolderExpanded, selectFolder, toggleFolder)
            }
            onLeafKeyDown={(event, node, tree) =>
              createLeafOnKeyDown(event, node, tree, selectFolder)
            }
          />
        )
      )}

      <NamingModeSwitch label="Name the folders" mode={mode} onChange={setMode} />

      {mode === 'pattern' ? (
        <fieldset
          className="folder-creator-fields"
          data-mode="pattern"
          disabled={listing === undefined || isCreating}
        >
          <Field label="Prefix" hint="Text in front of the number">
            <input
              className="input"
              type="text"
              value={prefix}
              spellCheck={false}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </Field>
          <Field label="Start at" hint="The number of the first new folder">
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Number style" hint="Whether short numbers get zeros in front">
            <NumberStyleSelect value={digits} onChange={setDigits} />
          </Field>
          <Field label="Suffix" hint="Text behind the number">
            <input
              className="input"
              type="text"
              value={suffix}
              spellCheck={false}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </Field>
          {countField}
        </fieldset>
      ) : (
        <fieldset
          className="folder-creator-fields"
          data-mode="date"
          disabled={listing === undefined || isCreating}
        >
          <Field label="Name" hint="Leave empty to name the folders by date only">
            <input
              className="input"
              type="text"
              value={dateSettings.name}
              spellCheck={false}
              onChange={(e) => updateDateSettings({ name: e.target.value })}
            />
          </Field>
          <Field label="Date goes">
            <select
              value={dateSettings.datePosition}
              onChange={(e) =>
                updateDateSettings({ datePosition: e.target.value as DateSettings['datePosition'] })
              }
            >
              <option value="before">Before the name</option>
              <option value="after">After the name</option>
            </select>
          </Field>
          <Field label="Between name and date">
            <select
              value={dateSettings.nameSeparator}
              onChange={(e) => updateDateSettings({ nameSeparator: e.target.value })}
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
              value={dateSettings.order}
              onChange={(e) => updateDateSettings({ order: e.target.value as FolderDateOrder })}
            >
              {DATE_ORDERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {formatFolderDate(firstDate ?? today(), value, dateSettings.dateSeparator)} (
                  {label})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Inside the date">
            <select
              value={dateSettings.dateSeparator}
              onChange={(e) => updateDateSettings({ dateSeparator: e.target.value })}
            >
              {SEPARATORS.map(([value, label]) => (
                <option key={label} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="First date">
            <input
              className="input"
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
            />
          </Field>
          <Field label="One folder per">
            <select
              value={dateSettings.step}
              onChange={(e) => updateDateSettings({ step: e.target.value as FolderDateStep })}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </Field>
          {countField}
        </fieldset>
      )}

      {mode === 'pattern' && seriesHint !== undefined && (
        <p className="folder-creator-hint">{seriesHint}</p>
      )}

      {listing !== undefined && (
        <p className={problem ? 'folder-creator-error' : 'folder-creator-preview'}>
          {problem ?? (
            <>
              Will create: <b>{preview}</b>
            </>
          )}
        </p>
      )}

      {result !== undefined && (
        <p className={result.isError ? 'folder-creator-error' : 'folder-creator-result'}>
          {result.message}
        </p>
      )}

      <fieldset className="dialog-actions">
        <Button
          styling="outlined"
          text="Show in File Browser"
          icon={IconSet.FOLDER_CLOSE}
          onClick={() => listing !== undefined && shell.openPath(listing.directory)}
          disabled={listing === undefined}
        />
        <Button styling="outlined" text="Close" onClick={uiStore.closeFolderCreator} />
        <Button
          styling="filled"
          onClick={create}
          text={
            names.length > 1 && !problem
              ? `Create ${names.length} folders`
              : names.length === 1 && !problem
              ? 'Create folder'
              : 'Create folders'
          }
          icon={IconSet.ADD}
          disabled={!canCreate}
        />
      </fieldset>
    </form>
  );
});

/** The gap between the New workspace dialog and the folder creator opened beside it, in pixels */
const BESIDE_GAP = 8;

/**
 * Beside the New workspace dialog while it is open, so that both can be seen (on the side with more room);
 * else in the corner of the gallery
 */
function placeFolderCreator(size: { width: number; height: number }) {
  const newWorkspace = document.querySelector('.new-workspace-dialog')?.closest('dialog');
  if (!newWorkspace) {
    return galleryCorner();
  }
  const rect = newWorkspace.getBoundingClientRect();
  return { left: besideLeft(rect, size.width, window.innerWidth, BESIDE_GAP), top: rect.top };
}

/**
 * Creates a batch of folders, named by number ([prefix] + incrementing number + [suffix]) or by date
 * ([name] + [date] or the other way around, one folder per day, week or month).
 * It only ever adds new, empty folders. Existing files and folders are not touched.
 */
const FolderCreator = observer(() => {
  const { uiStore } = useStore();

  return (
    <Dialog
      open={uiStore.isFolderCreatorOpen}
      title="Create Folders"
      icon={IconSet.FOLDER_CLOSE_ADD}
      onCancel={uiStore.closeFolderCreator}
      isMovable
      placeAt={placeFolderCreator}
    >
      {/* Mounted only while open, so it starts from the folder being looked at every time */}
      {uiStore.isFolderCreatorOpen && (
        <FolderCreatorForm startDirectory={uiStore.folderCreatorStart} />
      )}
    </Dialog>
  );
});

export default FolderCreator;

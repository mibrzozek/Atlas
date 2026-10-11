import { shell } from 'electron';
import fse from 'fs-extra';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import SysPath from 'path';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  FolderDate,
  FolderDateOrder,
  FolderDateStep,
  FolderSeries,
  MAX_FOLDERS_PER_BATCH,
  addToFolderDate,
  dateFolderNames,
  detectFolderSeries,
  formatFolderDate,
  folderSeriesName,
  folderSeriesNames,
  invalidFolderNameReason,
} from 'common/folder-series';
import { createFolders } from 'common/folder-create';
import { RendererMessenger } from 'src/ipc/renderer';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { useStore } from '../contexts/StoreContext';
import { ClientStringSearchCriteria } from '../entities/SearchCriteria';
import RootStore from '../stores/RootStore';

const LAST_DIRECTORY_STORAGE_KEY = 'folder-creator-directory';

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface Listing {
  directory: string;
  /** Names of the folders in the directory */
  folders: string[];
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
    folders,
    taken: new Set(entries.map((entry) => entry.name.toLowerCase())),
    series: detectFolderSeries(folders),
  };
}

/** The folder being looked at in the gallery, else the one used last time, else the first location */
function initialDirectory({ uiStore, locationStore }: RootStore): string | undefined {
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

type Mode = 'pattern' | 'date';
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

const SEPARATORS: [value: string, label: string][] = [
  ['-', 'Dash  ( - )'],
  ['_', 'Underscore  ( _ )'],
  ['.', 'Period  ( . )'],
  [' ', 'Space'],
  ['', 'Nothing'],
];

const DATE_ORDERS: [value: FolderDateOrder, label: string][] = [
  ['YMD', 'Y M D'],
  ['yMD', 'YY M D'],
  ['DMY', 'D M Y'],
  ['MDY', 'M D Y'],
  ['YM', 'Y M'],
];

// The value of an <input type="date"> is always YYYY-MM-DD
const toDateInputValue = (date: FolderDate) => formatFolderDate({ ...date }, 'YMD', '-');

function parseDateInputValue(value: string): FolderDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) }
    : undefined;
}

function today(): FolderDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** A labelled input. All fields in a row line up, whatever the length of their labels or the text size */
const Field = (props: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="folder-creator-field" data-tooltip={props.hint}>
    <span>{props.label}</span>
    {props.children}
  </label>
);

const FolderCreatorForm = observer(() => {
  const rootStore = useStore();
  const { uiStore, locationStore } = rootStore;

  const [listing, setListing] = useState<Listing>();
  const [directory, setDirectory] = useState<string | undefined>(() => initialDirectory(rootStore));
  const [readError, setReadError] = useState<string>();

  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [start, setStart] = useState('1');
  const [digits, setDigits] = useState('1');
  const [count, setCount] = useState('1');

  const [mode, setModeState] = useState<Mode>(() =>
    localStorage.getItem(MODE_STORAGE_KEY) === 'date' ? 'date' : 'pattern',
  );
  const setMode = (newMode: Mode) => {
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

  const open = useCallback((dir: string) => {
    setResult(undefined);
    setDirectory(dir);
  }, []);

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
      const location = runInAction(() =>
        locationStore.locationList.find(
          (loc) => dir === loc.path || dir.startsWith(loc.path + SysPath.sep),
        ),
      );
      location?.refreshSublocations().catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, listing, load, locationStore, names, mode, dateStart, dateSettings.step]);

  const { series } = listing ?? {};
  const seriesHint =
    listing === undefined
      ? undefined
      : series === undefined
      ? 'No numbered folders here yet: choose a prefix or suffix to start a series.'
      : `Continues the ${series.size} numbered folder${
          series.size === 1 ? '' : 's'
        } here: the last one is ${folderSeriesName(
          series.prefix,
          series.next - 1,
          series.digits,
          series.suffix,
        )}.`;

  // 1, 2, 3 up to 000001, and whatever longer style the folders here already use
  const numberStyles = [1, 2, 3, 4, 5, 6];
  if (digitCount !== undefined && digitCount > 6 && digitCount <= 15) {
    numberStyles.push(digitCount);
  }

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
          <span>Locations</span>
          {locationStore.locationList.map((location) => (
            <button
              key={location.id}
              type="button"
              className="btn-minimal"
              aria-pressed={location.path === directory}
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
        <ul className="folder-creator-list" aria-label="Folders in this folder">
          {listing?.folders.map((name) => (
            <li key={name}>
              <button
                type="button"
                data-tooltip="Open this folder"
                onClick={() => open(SysPath.join(listing.directory, name))}
              >
                {IconSet.FOLDER_CLOSE}
                <span>{name}</span>
              </button>
            </li>
          ))}
          {listing !== undefined && listing.folders.length === 0 && (
            <li className="folder-creator-empty">No folders in here yet</li>
          )}
        </ul>
      )}

      <div
        className="folder-creator-mode"
        role="radiogroup"
        aria-label="Name the folders"
        data-mode={mode}
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'pattern'}
          onClick={() => setMode('pattern')}
        >
          By pattern
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'date'}
          onClick={() => setMode('date')}
        >
          By date
        </button>
      </div>

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
            <select value={digits} onChange={(e) => setDigits(e.target.value)}>
              {numberStyles.map((width) => (
                <option key={width} value={String(width)}>
                  {[1, 2, 3].map((n) => String(n).padStart(width, '0')).join(', ')}
                </option>
              ))}
            </select>
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
      icon={IconSet.ADD_BOLD}
      onCancel={uiStore.closeFolderCreator}
      isMovable
    >
      {/* Mounted only while open, so it starts from the folder being looked at every time */}
      {uiStore.isFolderCreatorOpen && <FolderCreatorForm />}
    </Dialog>
  );
});

export default FolderCreator;

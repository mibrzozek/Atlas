/**
 * Numbered folder series: [prefix] + incrementing number + [suffix], e.g. S1, S2, S3 or Roll_007_scans.
 * Only names are computed here; nothing touches the file system.
 */

export interface FolderSeries {
  prefix: string;
  suffix: string;
  /** The number the next folder of the series would get */
  next: number;
  /** Minimum number of digits, for series with leading zeros like S01. 0 when there is no padding */
  digits: number;
  /** How many of the given names belong to the series */
  size: number;
  /** The name of the folder with the highest number */
  last: string;
}

export const MAX_FOLDERS_PER_BATCH = 500;

// The last run of digits is the counter, the text around it the same: "2024 Roll 3" continues as
// "2024 Roll 4"
const NUMBERED_NAME = /^(.*?)(\d+)(\D*)$/;
// Or the first run of digits, followed by a title of any kind: "126 Harbour" continues as "127"
const LEADING_NUMBER = /^(\D*?)(\d+)(.*)$/;

/**
 * Finds the numbering pattern most of the given folder names follow, if any.
 * With S1, S2, S3, S4 this returns the prefix "S" and 5 as the next number. Folders numbered in front of
 * titles that all differ (001 Beach, 002 Park, ...) are a series too, continued with the number alone;
 * it is taken only when more folders follow it than follow one with the same text around the number,
 * so a stray pair like "016 05012023 Release" and "016 05012024 Release" does not lead the way.
 */
export function detectFolderSeries(names: readonly string[]): FolderSeries | undefined {
  const exact = new Map<string, FolderSeries>();
  const titled = new Map<string, FolderSeries>();
  for (const name of names) {
    countIn(exact, name, NUMBERED_NAME, true);
    countIn(titled, name, LEADING_NUMBER, false);
  }
  const bestExact = largest(exact);
  const bestTitled = largest(titled);
  return bestTitled !== undefined && (bestExact === undefined || bestTitled.size > bestExact.size)
    ? bestTitled
    : bestExact;
}

/** Counts a name into the series it belongs to by `pattern`: the text before the counter, and after it */
function countIn(
  groups: Map<string, FolderSeries>,
  name: string,
  pattern: RegExp,
  isSuffixFixed: boolean,
) {
  const match = pattern.exec(name);
  // More than 15 digits cannot be counted exactly; such names are IDs rather than counters anyway
  if (!match || match[2].length > 15) {
    return;
  }
  const [, prefix, number, rest] = match;
  const suffix = isSuffixFixed ? rest : '';
  const value = parseInt(number, 10);
  const digits = number.length > 1 && number.startsWith('0') ? number.length : 0;
  // Folder names only differing in case are the same series on Windows and macOS
  const key = `${prefix}\u0000${suffix}`.toLowerCase();
  const group = groups.get(key);
  if (!group) {
    groups.set(key, { prefix, suffix, next: value + 1, digits, size: 1, last: name });
  } else {
    group.size += 1;
    group.digits = Math.max(group.digits, digits);
    if (value + 1 > group.next) {
      group.next = value + 1;
      group.last = name;
      // Take the spelling of the latest folder
      group.prefix = prefix;
      group.suffix = suffix;
    }
  }
}

/** The series most folders follow; of two as large, the one that has come furthest */
function largest(groups: Map<string, FolderSeries>): FolderSeries | undefined {
  let best: FolderSeries | undefined;
  for (const group of groups.values()) {
    if (!best || group.size > best.size || (group.size === best.size && group.next > best.next)) {
      best = group;
    }
  }
  return best;
}

export function folderSeriesName(
  prefix: string,
  number: number,
  digits: number,
  suffix: string,
): string {
  return `${prefix}${String(number).padStart(digits, '0')}${suffix}`;
}

export function folderSeriesNames(
  prefix: string,
  start: number,
  digits: number,
  suffix: string,
  count: number,
): string[] {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    names.push(folderSeriesName(prefix, start + i, digits, suffix));
  }
  return names;
}

/**
 * Folders named by date: [name] + [date] or [date] + [name], one folder per day, week or month.
 */

/** Which parts of the date are written, in which order. `yMD` has a two digit year */
export const FOLDER_DATE_ORDERS = ['YMD', 'yMD', 'DMY', 'MDY', 'YM'] as const;
export type FolderDateOrder = (typeof FOLDER_DATE_ORDERS)[number];
export type FolderDateStep = 'day' | 'week' | 'month';

/** A calendar day; month is 1 to 12 */
export interface FolderDate {
  year: number;
  month: number;
  day: number;
}

/** The calendar day a moment falls on, in local time */
export function folderDateOf(date: Date): FolderDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export interface DateFolderOptions {
  name: string;
  /** Whether the date comes before or after the name */
  datePosition: 'before' | 'after';
  order: FolderDateOrder;
  /** Between the parts of the date, e.g. "-" for 2026-10-11 */
  dateSeparator: string;
  /** Between the name and the date. Not used without a name */
  nameSeparator: string;
  start: FolderDate;
  step: FolderDateStep;
  count: number;
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

/** The date `steps` days, weeks or months after the given one */
export function addToFolderDate(date: FolderDate, step: FolderDateStep, steps: number): FolderDate {
  if (step === 'month') {
    const monthIndex = date.year * 12 + (date.month - 1) + steps;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    // The 31st of a month without one becomes its last day
    return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
  }
  // Constructed from calendar parts, so daylight saving time cannot shift the day
  const result = new Date(date.year, date.month - 1, date.day + steps * (step === 'week' ? 7 : 1));
  return { year: result.getFullYear(), month: result.getMonth() + 1, day: result.getDate() };
}

export function formatFolderDate(
  date: FolderDate,
  order: FolderDateOrder,
  separator: string,
): string {
  const year = String(date.year).padStart(4, '0');
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  switch (order) {
    case 'YMD':
      return [year, month, day].join(separator);
    case 'yMD':
      return [year.slice(-2), month, day].join(separator);
    case 'DMY':
      return [day, month, year].join(separator);
    case 'MDY':
      return [month, day, year].join(separator);
    case 'YM':
      return [year, month].join(separator);
  }
}

export function dateFolderNames(options: DateFolderOptions): string[] {
  const { name, datePosition, order, dateSeparator, nameSeparator, start, step, count } = options;
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatFolderDate(addToFolderDate(start, step, i), order, dateSeparator);
    names.push(
      name.length === 0
        ? date
        : datePosition === 'before'
        ? `${date}${nameSeparator}${name}`
        : `${name}${nameSeparator}${date}`,
    );
  }
  return names;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Returns why the name cannot be used for a folder, or undefined when it is fine on every platform */
export function invalidFolderNameReason(name: string): string | undefined {
  if (name.length === 0) {
    return 'The name is empty';
  }
  if (name.length > 255) {
    return 'The name is too long';
  }
  // eslint-disable-next-line no-control-regex
  const illegal = /[\\/:*?"<>|\u0000-\u001f]/.exec(name);
  if (illegal) {
    return `The character ${JSON.stringify(illegal[0])} is not allowed in folder names`;
  }
  if (name !== name.trim()) {
    return 'The name cannot start or end with a space';
  }
  if (name.endsWith('.')) {
    return 'The name cannot end with a dot';
  }
  if (WINDOWS_RESERVED_NAME.test(name)) {
    return `"${name}" is a reserved name on Windows`;
  }
  return undefined;
}

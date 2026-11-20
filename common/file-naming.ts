/**
 * How the files a workspace saves are named: a number after a prefix and before a suffix, or a date. The
 * next name is worked out from the names already in the folder; nothing is written here.
 */
import fse from 'fs-extra';
import { fileNameOf, fileTextOf } from './export';
import {
  dateFolderNames,
  detectFolderSeries,
  FOLDER_DATE_ORDERS,
  FolderDate,
  FolderDateOrder,
  folderDateOf,
  folderSeriesName,
} from './folder-series';

export interface PatternNaming {
  mode: 'pattern';
  prefix: string;
  /** Minimum number of digits: 3 gives 001, 002 ... 0 gives 1, 2 ... */
  digits: number;
  suffix: string;
}

/** How the date is written in a name: where it goes, its order and its separators */
export interface DateStyle {
  datePosition: 'before' | 'after';
  order: FolderDateOrder;
  /** Between the parts of the date, e.g. "-" for 2026-11-19 */
  dateSeparator: string;
  /** Between the name and the date. Not used without a name */
  nameSeparator: string;
}

export interface DateNaming extends DateStyle {
  mode: 'date';
  name: string;
}

export type FileNaming = PatternNaming | DateNaming;

const stemOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

/** The number in a name of the pattern (prefix + digits + suffix, ignoring case), if it is one */
function numberIn(stem: string, prefix: string, suffix: string): string | undefined {
  if (stem.length <= prefix.length + suffix.length) {
    return undefined;
  }
  const digits = stem.slice(prefix.length, stem.length - suffix.length);
  const isPattern =
    stem.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase() &&
    stem.slice(stem.length - suffix.length).toLowerCase() === suffix.toLowerCase() &&
    /^\d+$/.test(digits);
  return isPattern ? digits : undefined;
}

/**
 * The name the next file gets in a folder with these names taken, its extension or not. A pattern goes on
 * from the highest number already used with the same prefix and suffix, else starts at 1. A date is the
 * day's name. The name is made fit for a file name, so that it can be written as it is.
 */
export function nextFileName(
  naming: FileNaming,
  takenNames: readonly string[],
  date: FolderDate,
): string {
  if (naming.mode === 'date') {
    const { name, datePosition, order, dateSeparator, nameSeparator } = naming;
    const [dated] = dateFolderNames({
      name,
      datePosition,
      order,
      dateSeparator,
      nameSeparator,
      start: date,
      step: 'day',
      count: 1,
    });
    return fileNameOf(dated);
  }
  const prefix = fileTextOf(naming.prefix);
  const suffix = fileTextOf(naming.suffix);
  const used = takenNames
    .map(stemOf)
    .map((stem) => numberIn(stem, prefix, suffix))
    .filter((digits): digits is string => digits !== undefined);
  const next = detectFolderSeries(used)?.next ?? 1;
  return fileNameOf(folderSeriesName(prefix, next, naming.digits, suffix));
}

/** The next name for a folder: only its names are read, and the name is worked out from them */
export async function nextFileNameIn(naming: FileNaming, folder: string): Promise<string> {
  // A folder that cannot be read has nothing taken; saving into it reports that
  const taken = await fse.readdir(folder).catch(() => []);
  return nextFileName(naming, taken, folderDateOf(new Date()));
}

/** A naming as stored with a workspace, or undefined when what is stored is not one (or there is none) */
export function fileNamingFromRow(value: unknown): FileNaming | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (row.mode === 'pattern') {
    const { prefix, digits, suffix } = row;
    if (
      typeof prefix !== 'string' ||
      typeof suffix !== 'string' ||
      typeof digits !== 'number' ||
      !Number.isInteger(digits) ||
      digits < 0 ||
      digits > 15
    ) {
      return undefined;
    }
    return { mode: 'pattern', prefix, digits, suffix };
  }
  if (row.mode === 'date') {
    const { name, datePosition, order, dateSeparator, nameSeparator } = row;
    return typeof name === 'string' &&
      (datePosition === 'before' || datePosition === 'after') &&
      FOLDER_DATE_ORDERS.some((known) => known === order) &&
      typeof dateSeparator === 'string' &&
      typeof nameSeparator === 'string'
      ? {
          mode: 'date',
          name,
          datePosition,
          order: order as FolderDateOrder,
          dateSeparator,
          nameSeparator,
        }
      : undefined;
  }
  return undefined;
}

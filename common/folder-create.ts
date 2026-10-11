import * as fse from 'fs-extra';
import * as path from 'path';

import { invalidFolderNameReason } from './folder-series';

export interface CreateFoldersResult {
  /** The names of the folders that were created, in order */
  created: string[];
  /** Why it stopped before all folders were created */
  error?: Error;
}

/**
 * Creates new, empty folders directly inside an existing directory, and does nothing else.
 *
 * This is the only place the folder creator writes to disk, possibly inside the user's photo folders:
 * - The one file system call is a plain `mkdir`. It fails when anything with that name exists (a folder, a
 *   file, a link, also when only the case differs on Windows and macOS), so nothing can be replaced, emptied
 *   or merged into. There is no recursive mkdir, rename, copy, write or delete.
 * - A name can only be a single folder name: no path separators, no "..", so nothing is created elsewhere.
 * - It stops at the first failure and never cleans up after itself, since that would mean deleting.
 */
export async function createFolders(
  directory: string,
  names: readonly string[],
): Promise<CreateFoldersResult> {
  const parent = path.resolve(directory);
  const created: string[] = [];
  try {
    for (const name of names) {
      const invalid = invalidFolderNameReason(name);
      if (invalid !== undefined) {
        throw new Error(`"${name}" cannot be used: ${invalid}`);
      }
      const target = path.join(parent, name);
      if (path.dirname(target) !== parent || path.basename(target) !== name) {
        throw new Error(`"${name}" is not a single folder name`);
      }
      await fse.mkdir(target);
      created.push(name);
    }
  } catch (e) {
    // Not `instanceof Error`: file system errors can come from another JavaScript realm
    const isError = typeof e === 'object' && e !== null && 'message' in e;
    return { created, error: isError ? (e as Error) : new Error(String(e)) };
  }
  return { created };
}

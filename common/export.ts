// Needed for test:
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
import { copy, ensureDir, readdir, writeFile } from 'fs-extra';

export interface ExportResult {
  copied: number;
  /** Files that are already located in the target directory */
  skipped: number;
  /** The source paths that could not be copied, e.g. when the file is missing */
  failed: string[];
}

// File names on Windows and (by default) macOS are case-insensitive
const nameKey = (name: string) => name.toLowerCase();

function getAvailableName(fileName: string, takenNames: Set<string>): string {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = fileName;
  for (let i = 2; takenNames.has(nameKey(candidate)); i++) {
    candidate = `${stem} (${i})${ext}`;
  }
  return candidate;
}

/**
 * Copies files into a directory without ever overwriting anything:
 * when a file name is already taken, the copy is named like "name (2).jpg".
 */
export async function exportFilesToDirectory(
  sourcePaths: string[],
  targetDir: string,
  onProgress?: (numProcessed: number, total: number) => void,
): Promise<ExportResult> {
  await ensureDir(targetDir);
  const resolvedTargetDir = nameKey(path.resolve(targetDir));
  const takenNames = new Set((await readdir(targetDir)).map(nameKey));
  const sources = Array.from(new Set(sourcePaths));
  const result: ExportResult = { copied: 0, skipped: 0, failed: [] };

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (nameKey(path.resolve(path.dirname(source))) === resolvedTargetDir) {
      result.skipped++;
    } else {
      const name = getAvailableName(path.basename(source), takenNames);
      try {
        await copy(source, path.join(targetDir, name), {
          overwrite: false,
          errorOnExist: true,
          preserveTimestamps: true,
        });
        takenNames.add(nameKey(name));
        result.copied++;
      } catch (e) {
        console.error('Could not export file', source, e);
        result.failed.push(source);
      }
    }
    onProgress?.(i + 1, sources.length);
  }
  return result;
}

/** Names Windows keeps for devices: a file called so can not be opened or deleted in Explorer */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
/** Long enough for any name, short enough for the folder and an extension to fit in a path */
const MAX_NAME_LENGTH = 200;

/**
 * A name someone typed, as a file name: without the letters Windows does not allow in one, nor the dots
 * and spaces it drops from the end, not one of the names it keeps for devices, and not too long. Empty
 * when nothing is left.
 */
export function fileNameOf(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[. ]+$/, '')
    .trim();
  return RESERVED_NAMES.test(cleaned) ? `${cleaned}_` : cleaned;
}

/**
 * Writes a new file into a directory, never over another: when the name is taken it becomes like
 * "name (2).png". The write itself refuses a file that exists (`wx`), also one made in the meantime.
 * Returns the path it was written to.
 */
export async function writeNewFile(
  targetDir: string,
  fileName: string,
  data: Uint8Array,
): Promise<string> {
  const takenNames = new Set((await readdir(targetDir)).map(nameKey));
  for (;;) {
    const name = getAvailableName(fileName, takenNames);
    const filePath = path.join(targetDir, name);
    try {
      await writeFile(filePath, data, { flag: 'wx' });
      return filePath;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
      takenNames.add(nameKey(name));
    }
  }
}

// Needed for test:
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
import { copy, ensureDir, readdir } from 'fs-extra';

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

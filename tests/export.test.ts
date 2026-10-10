import * as fse from 'fs-extra';
import * as path from 'path';

import { exportFilesToDirectory } from '../common/export';

describe('exportFilesToDirectory', () => {
  let root: string;
  let target: string;

  const write = async (relativePath: string, content: string) => {
    const filePath = path.join(root, relativePath);
    await fse.outputFile(filePath, content);
    return filePath;
  };

  beforeEach(async () => {
    root = await fse.mkdtemp(path.join(__dirname, 'tmp-export-test-'));
    target = path.join(root, 'exported');
  });

  afterEach(() => fse.remove(root));

  it('copies files into a new directory and leaves the originals in place', async () => {
    const a = await write('a/one.jpg', 'one');
    const b = await write('b/two.png', 'two');

    const result = await exportFilesToDirectory([a, b], target);

    expect(result).toEqual({ copied: 2, skipped: 0, failed: [] });
    expect((await fse.readdir(target)).sort()).toEqual(['one.jpg', 'two.png']);
    expect(await fse.readFile(a, 'utf8')).toBe('one');
  });

  it('renames instead of overwriting when names clash', async () => {
    const existing = await write('exported/photo.jpg', 'already there');
    const a = await write('a/photo.jpg', 'from a');
    const b = await write('b/PHOTO.jpg', 'from b');

    const result = await exportFilesToDirectory([a, b], target);

    expect(result.copied).toBe(2);
    expect(await fse.readFile(existing, 'utf8')).toBe('already there');
    expect(await fse.readFile(path.join(target, 'photo (2).jpg'), 'utf8')).toBe('from a');
    expect(await fse.readFile(path.join(target, 'PHOTO (3).jpg'), 'utf8')).toBe('from b');
  });

  it('skips files that are already in the target directory', async () => {
    const inTarget = await write('exported/photo.jpg', 'same');

    const result = await exportFilesToDirectory([inTarget], target);

    expect(result).toEqual({ copied: 0, skipped: 1, failed: [] });
    expect(await fse.readdir(target)).toEqual(['photo.jpg']);
  });

  it('reports missing files and continues with the rest', async () => {
    const missing = path.join(root, 'a', 'gone.jpg');
    const a = await write('a/here.jpg', 'here');
    const progress: number[] = [];

    const result = await exportFilesToDirectory([missing, a, a], target, (n) => progress.push(n));

    expect(result).toEqual({ copied: 1, skipped: 0, failed: [missing] });
    expect(progress).toEqual([1, 2]);
  });
});

import * as fse from 'fs-extra';
import * as path from 'path';

import { exportFilesToDirectory, fileNameOf, writeNewFile } from '../common/export';

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

describe('fileNameOf', () => {
  it('leaves out what a Windows file name cannot have', () => {
    expect(fileNameOf('Spring: series 2/3')).toBe('Spring series 2 3');
    expect(fileNameOf('  moodboard...  ')).toBe('moodboard');
    expect(fileNameOf('a\tb?')).toBe('a b');
    expect(fileNameOf('***')).toBe('');
  });

  it('keeps clear of the names Windows keeps for devices, and of names too long', () => {
    expect(fileNameOf('CON')).toBe('CON_');
    expect(fileNameOf('com1')).toBe('com1_');
    expect(fileNameOf('Console')).toBe('Console');
    expect(fileNameOf('a'.repeat(300))).toHaveLength(200);
  });
});

describe('writeNewFile', () => {
  let root: string;

  beforeEach(async () => {
    root = await fse.mkdtemp(path.join(__dirname, 'tmp-export-test-'));
  });

  afterEach(() => fse.remove(root));

  it('writes a new file, and next to one of the same name under another name', async () => {
    await fse.outputFile(path.join(root, 'Sheet.png'), 'already there');
    const first = await writeNewFile(root, 'sheet.png', Buffer.from('new'));
    const second = await writeNewFile(root, 'sheet.png', Buffer.from('newer'));
    expect(path.basename(first)).toBe('sheet (2).png');
    expect(path.basename(second)).toBe('sheet (3).png');
    expect(await fse.readFile(path.join(root, 'Sheet.png'), 'utf8')).toBe('already there');
    expect(await fse.readFile(second, 'utf8')).toBe('newer');
  });
});

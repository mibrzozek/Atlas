import * as fse from 'fs-extra';
import * as path from 'path';

import { createFolders } from '../common/folder-create';

/** Every file and folder below the directory, with the content of the files and all modified dates */
async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await fse.readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      const relativePath = path.relative(directory, entryPath);
      const { mtimeMs } = await fse.stat(entryPath);
      if (entry.isDirectory()) {
        result[relativePath] = `dir @${mtimeMs}`;
        await walk(entryPath);
      } else {
        result[relativePath] = `file @${mtimeMs}: ${await fse.readFile(entryPath, 'utf8')}`;
      }
    }
  };
  await walk(directory);
  return result;
}

describe('createFolders', () => {
  let root: string;
  let scan: string;

  beforeEach(async () => {
    root = await fse.mkdtemp(path.join(__dirname, 'tmp-folder-create-test-'));
    scan = path.join(root, 'SCAN');
    // A folder with photos in it, a sub folder, and a file without extension
    await fse.outputFile(path.join(scan, 'S1', 'photo.jpg'), 'photo 1');
    await fse.outputFile(path.join(scan, 'S1', 'raw', 'photo.cr2'), 'raw 1');
    await fse.outputFile(path.join(scan, 'S2', 'photo.jpg'), 'photo 2');
    await fse.outputFile(path.join(scan, 'S4'), 'a file named like a folder');
    await fse.outputFile(path.join(root, 'outside.txt'), 'outside');
  });

  afterEach(() => fse.remove(root));

  it('creates new empty folders and changes nothing that was there', async () => {
    const before = await snapshot(scan);

    const result = await createFolders(scan, ['S5', 'S6', 'S7']);

    expect(result).toEqual({ created: ['S5', 'S6', 'S7'] });
    for (const name of ['S5', 'S6', 'S7']) {
      expect(await fse.readdir(path.join(scan, name))).toEqual([]);
    }
    expect(await snapshot(scan)).toEqual({
      ...before,
      S5: expect.stringMatching(/^dir/),
      S6: expect.stringMatching(/^dir/),
      S7: expect.stringMatching(/^dir/),
    });
  });

  it('refuses a name that is taken by a folder, and leaves that folder and its files alone', async () => {
    const before = await snapshot(root);

    const result = await createFolders(scan, ['S1']);

    expect(result.created).toEqual([]);
    expect(result.error).toMatchObject({ code: 'EEXIST' });
    expect(await snapshot(root)).toEqual(before);
  });

  it('refuses a name that is taken by a file, and leaves that file alone', async () => {
    const before = await snapshot(root);

    const result = await createFolders(scan, ['S4']);

    expect(result.created).toEqual([]);
    expect(result.error).toMatchObject({ code: 'EEXIST' });
    expect(await snapshot(root)).toEqual(before);
  });

  it('never replaces a folder whose name only differs in case', async () => {
    const before = await snapshot(scan);

    const result = await createFolders(scan, ['s1']);

    // Refused on Windows and macOS; a separate new folder where names are case sensitive
    const after = await snapshot(scan);
    if (result.error) {
      expect(result.error).toMatchObject({ code: 'EEXIST' });
      expect(after).toEqual(before);
    } else {
      expect(after).toEqual({ ...before, s1: expect.stringMatching(/^dir/) });
    }
  });

  it('stops at the first name that is taken, and removes nothing it made before', async () => {
    const result = await createFolders(scan, ['S9', 'S2', 'S10']);

    expect(result.created).toEqual(['S9']);
    expect(result.error).toMatchObject({ code: 'EEXIST' });
    expect((await fse.readdir(scan)).sort()).toEqual(['S1', 'S2', 'S4', 'S9']);
    expect(await fse.readFile(path.join(scan, 'S2', 'photo.jpg'), 'utf8')).toBe('photo 2');
  });

  it('cannot be made to create, or touch, anything outside the directory', async () => {
    const before = await snapshot(root);
    const sneaky = [
      '..',
      '.',
      '../escaped',
      '..\\escaped',
      'S1/inside',
      'S1\\inside',
      path.join(root, 'absolute'),
      'C:\\absolute',
      '/absolute',
      'S9/../../escaped',
      '',
      ' ',
    ];

    for (const name of sneaky) {
      const result = await createFolders(scan, [name]);
      expect(result.created).toEqual([]);
      expect(result.error).toBeDefined();
    }

    expect(await snapshot(root)).toEqual(before);
  });

  it('does not create the directory itself when it is missing', async () => {
    const before = await snapshot(root);
    const missing = path.join(root, 'does', 'not', 'exist');

    const result = await createFolders(missing, ['S1']);

    expect(result.created).toEqual([]);
    expect(result.error).toMatchObject({ code: 'ENOENT' });
    expect(await snapshot(root)).toEqual(before);
  });

  it('running the same batch twice changes nothing the second time', async () => {
    await createFolders(scan, ['S5', 'S6']);
    await fse.outputFile(path.join(scan, 'S5', 'new-photo.jpg'), 'added later');
    const before = await snapshot(root);

    const result = await createFolders(scan, ['S5', 'S6']);

    expect(result.created).toEqual([]);
    expect(result.error).toMatchObject({ code: 'EEXIST' });
    expect(await snapshot(root)).toEqual(before);
  });
});

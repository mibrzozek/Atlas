import * as fs from 'fs';
import * as path from 'path';

// The Director and the debugging port are development only (CLAUDE.md). The real check is of the
// production build (scripts/check-production-bundle.js); this one keeps the source honest between builds.

const root = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const filesIn = (folder: string): string[] =>
  fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.(ts|tsx|js)$/.test(entry.name) ? [file] : [];
  });

describe('the Director and the debugging port', () => {
  it('are started only behind the development checks', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(
      /if \(process\.env\.NODE_ENV === 'development'\) \{\s*if \(!app\.isPackaged\) \{[^}]*require\('\.\/director\/main'\)/,
    );
    const renderer = read('src/renderer.tsx');
    expect(renderer).toMatch(
      /if \(process\.env\.NODE_ENV === 'development'\) \{[^}]*require\('\.\/frontend\/director'\)/,
    );
  });

  it('are reached from nowhere else', () => {
    const others = filesIn('src').filter(
      (file) =>
        !file.includes(path.join('src', 'director')) &&
        !file.includes(path.join('frontend', 'director')),
    );
    for (const file of others) {
      const text = read(file);
      const isStarter = [path.join('src', 'main.ts'), path.join('src', 'renderer.tsx')].includes(
        file,
      );
      const requires = text.match(/director\/main'|frontend\/director'/g) ?? [];
      expect([file, requires.length]).toEqual([file, isStarter ? 1 : 0]);
      // The debugging port is never opened by the app itself
      expect([file, /remote-debugging/.test(text)]).toEqual([file, false]);
    }
  });
});

// Run after the production build (`yarn production`, and so `yarn build` and both GitHub workflows): fails
// when anything of the Director (the development-only command channel) or of Chromium's debugging port is
// in what would be shipped. Both must only ever be in the development build (CLAUDE.md).
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [
  /remote-debugging/,
  /remoteDebugging/,
  // The Director's messages, files and entry points (src/director, src/frontend/director). Whole words:
  // libraries have plenty of `.directory`
  /atlas-director/,
  /\.director\b/,
  /\b(start|install)Director\b/,
];

const build = path.join(__dirname, '..', 'build');
const bundles = fs.readdirSync(build).filter((name) => name.endsWith('.js'));
if (bundles.length === 0) {
  console.error('No bundles in build/: run the production build first');
  process.exit(1);
}
const found = [];
for (const name of bundles) {
  const text = fs.readFileSync(path.join(build, name), 'utf8');
  for (const pattern of FORBIDDEN) {
    const match = text.match(pattern);
    if (match !== null) {
      found.push(`${name}: ${match[0]}`);
    }
  }
}
if (found.length > 0) {
  console.error('Development-only code is in the production build:\n  ' + found.join('\n  '));
  process.exit(1);
}
console.log(`Production build checked: no Director, no debugging port (${bundles.length} bundles)`);

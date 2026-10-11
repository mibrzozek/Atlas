// Launches Atlas as a brand-new user: an empty profile with no library, settings or thumbnails.
// Your normal Atlas data is not read or changed, and both can run at the same time.
//
//   yarn oobe          start with a fresh, empty profile (wipes the previous test profile)
//   yarn oobe --keep   start again with the test profile of the last run, like a second launch
//
// Everything Atlas stores during the test lives in the .oobe-profile folder of this repository.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const profileDir = path.join(root, '.oobe-profile');
const tempDir = path.join(profileDir, 'temp');
const mainBundle = path.join(root, 'build', 'main.bundle.js');

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const extraArgs = args.filter((arg) => arg !== '--keep');

if (!fs.existsSync(mainBundle)) {
  console.error('Atlas has not been built yet: run "yarn dev" or "yarn build" first.');
  process.exit(1);
}

if (!keep) {
  // Only ever this one folder, which contains nothing but what the test profile stored
  fs.rmSync(profileDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

console.log(`${keep ? 'Reusing' : 'Fresh'} test profile: ${profileDir}`);

// The profile holds the database, settings and backups. Thumbnails go to the system's temporary
// folder by default, so that is redirected into the profile as well.
const electron = require('electron');
// Started on its own, so the terminal is free again right away
const child = spawn(electron, [mainBundle, `--user-data-dir=${profileDir}`, ...extraArgs], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
});
child.unref();

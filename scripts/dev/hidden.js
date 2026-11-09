// The hidden copy of Atlas: the development build in windows nobody sees, with a profile of its own
// (.dev-hidden-profile/, git-ignored) and Chromium's debugging port on a random port. It is the only Atlas
// that ever opens that port, and only while it runs. See CLAUDE.md.
//
//   node scripts/dev/hidden.js start     starts it (kept running between checks), prints its port
//   node scripts/dev/hidden.js stop      stops it, and the ExifTool it started
//   node scripts/dev/hidden.js status
//
// While it runs, `node scripts/dev/atlas.js --to hidden <command>` talks to its Director.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..');
const profile = path.join(repo, '.dev-hidden-profile');
const electron = path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe');

const powershell = (command) =>
  spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).stdout;

/**
 * The processes of the hidden copy: Electron by its name and by this profile on its command line (never
 * by a process id kept from before, which Windows may have given to something else since), and the
 * ExifTool it unpacked into the profile, by where it runs from
 */
const processes = () =>
  powershell(
    `Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { $_.ProcessId }; ` +
      `Get-Process exiftool -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.Path -like '${profile}*' } | ForEach-Object { $_.Id }`,
  )
    .split(/\s+/)
    .filter((id) => id !== '')
    .map(Number);

const running = () => processes().length > 0;

/** Chromium writes the port it picked (for --remote-debugging-port=0) into the profile */
const debuggingPort = async () => {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let tries = 0; tries < 100; tries++) {
    if (fs.existsSync(file)) {
      return Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('It did not open its debugging port');
};

const commands = {
  start: async () => {
    if (running()) {
      console.log(`Already running, debugging port ${await debuggingPort()}`);
      return;
    }
    const temp = path.join(profile, 'temp');
    fs.mkdirSync(temp, { recursive: true });
    fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
    const child = spawn(
      electron,
      [
        path.join(__dirname, 'hidden-entry.js'),
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, TEMP: temp, TMP: temp },
      },
    );
    child.unref();
    console.log(`Started, debugging port ${await debuggingPort()}`);
  },

  stop: () => {
    const ids = processes();
    for (const id of ids) {
      spawnSync('taskkill', ['/F', '/PID', String(id)], { stdio: 'ignore' });
    }
    fs.rmSync(path.join(repo, '.director', 'hidden.json'), { force: true });
    console.log(ids.length > 0 ? 'Stopped' : 'It was not running');
  },

  status: async () =>
    console.log(running() ? `Running, debugging port ${await debuggingPort()}` : 'Not running'),
};

const command = commands[process.argv[2]];
if (command === undefined) {
  console.error('node scripts/dev/hidden.js start|stop|status');
  process.exit(1);
}
Promise.resolve(command()).then(
  () => process.exit(0),
  (e) => {
    console.error(String(e));
    process.exit(1);
  },
);

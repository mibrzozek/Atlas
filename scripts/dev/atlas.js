// Sends one command to the Director of a running Atlas (development build) and prints the answer; exits as
// soon as it has it, and every wait has an end. See CLAUDE.md and docs/director-plan.md.
//
//   node scripts/dev/atlas.js [--to hidden] [--out picture.jpg] <command> [arguments...]
//
// Arguments are read as JSON when they are JSON (numbers, {"tag": "..."}), else as text. Commands:
//   start                                     the user's Atlas, if it is not running: started by Windows
//                                             (not by this command, so it lives on whatever happens to
//                                             the shell), answered once it is ready
//   restart                                   Atlas closes and starts again by itself (a change to
//                                             src/main.ts or src/director/ is then in it); once ready
//   reload                                    the window loaded again (any other change is then in it)
//   whoAmI, tags, collections, workspaces, songs, effects, ready
//   windows                                   every window: visible, minimized, off-screen, bounds
//   duplicate <workspace id>                  a copy right after it, opened, as Duplicate does
//   create <name> {"tag": "<tag>"} | {"collection": "<collection>"}   add "sample": 40, "seed": 1 for
//                                             40 of them picked at random (a large tag or collection)
//   arrange <workspace id> columns|rows|grid [count] [gap] [{"photos": [2, 5, 9], "below": true}]
//                                             only those photos, in that order; below: under everything else
//   place <workspace id> [{"photo": 1, "x": 0, "y": 0, "width": 100, "height": 150}, ...]
//                                             exact positions/sizes stacked top-down (for nested compositions)
//   group <workspace id> <name> [photos...] [{"lock": true}]   group named photos into a labelled layer group
//   ungroup <workspace id> <name>             ungroup a named layer group (keeps its layers)
//   copy <workspace id> [photos...]           duplicate named photos (safe inside locked groups); returns new photo numbers
//   photosInfo <workspace id>                 metadata per photo layer: n, fileId, name, aspect, bounds, group, isCopy
//   deleteItems <workspace id> [photos...]    remove named photo layers from the workspace (never touches files on disk)
//   deleteWorkspace <workspace id>            delete a workspace (never touches files on disk)
//   path <workspace id> <seed> [gap] [{"turns": "loop"}]   its photos along a path to pan over: short rows
//                                             of the wide ones and columns of the tall ones in turn, turning
//                                             at random, or with "loop" right, down, left, up round and round
//                                             (the other kind fills in where one is short); answers the
//                                             frames to pan between and the photos each leg runs over (to
//                                             hide first, with a fade-out)
//   shuffle <workspace id> <seed>
//   extend <workspace id> [{"columns": 6, "above": 4000, "below": 4000, "seed": 1}]   the photos repeated as a
//                                             wall: copies in columns beside the block and above and below it
//                                             (pixels), never next to a copy of their own photo; added after the
//                                             photos, so their numbers stay; answers the counts and the bounds
//   title <workspace id> <text> [line] [{"title": "#f2c14e", "sheet": "#0c0c0e"}]
//   video <workspace id> [9:16|4:5|1:1|16:9]
//   layout <workspace id>                     the arrangement now, as the next layout
//   music <workspace id> <file name in audio/>
//   sound <workspace id> <"category/file.mp3", as effects lists it> <at seconds> [{"volume": 0.8}]
//                                             a sound effect from audio/sfx/ starting then; its number
//   end <workspace id> [seconds]             where the video ends; none: the end of its camera
//   waves <workspace id> [strength]          a wave through the photos on every swell of its song
//   edit <workspace id> cuts|flow|mixed <seed>
//   save <workspace id> phone|full            into demo/, a new file
//   picture <workspace id> [times...] [{"width": 540}] --out <file.jpg>   frames side by side, each this wide
//   cuts <workspace id> [{"width": 360, "from": 1}] --out <file.jpg>      the first frame, then per cut the last
//                                             moment of a shot and the arrival of the next, then the last
//                                             frame; 32 moments a sheet, from: the shot to start at
//   contact <workspace id> [{"width": 360, "from": 1}] --out <file.jpg>   each file alone, whole, numbered as
//                                             timeline numbers its first photo (a wall's copies left out);
//                                             32 a sheet, from: the photo to start at
//   soundPicture <workspace id> [from] [to] --out <file.png>   its song, beats, swells, sound effects and motions in time
//   state <workspace id>
//
// Editing a video (numbers from 1, as `timeline` lists them; each command one change to undo):
//   timeline <workspace id>                   every shot, layout and motion, numbered, and what it does
//   photos <workspace id> [time] --out <file.jpg>   everything, each photo's number on it, the shot outlined,
//                                             a ring at each photo's subject
//   subject <workspace id> <photo> [x y]      where a photo's subject is (0 to 1 across and down, of the whole
//                                             photo); no x and y: taken away. Framing a photo then aims at it
//   setShot <workspace id> <shot> {...}       {"photo": 12} fills it with photo 12 ("room": 0.1 shows all
//                                             of it), or {"photos": [3, 4]}, {"title": true}, {"all": true},
//                                             {"frame": [x, y, w, h]}; then "zoom": 1.5, "move": [0.1, 0];
//                                             and "length", "arrival", "arrivalTime", "stay", "easing".
//                                             A pan over all of a photo: {"photo": 12, "align": "start"},
//                                             then a shot {"photo": 12, "align": "end", "arrival": "scroll"}
//   addShot <workspace id> <after shot, 0: first> [{...}]   the same changes
//   addMotion <workspace id> <kind> <[photos]|all> <start> [{"length", "strength", "speed", "stagger"}]
//   setMotion <workspace id> <motion> {"kind", "photos", "start", "length", "strength", "speed", "stagger"}
//   setLayout <workspace id> <layout> {"length", "transition", "easing"}
//   remove <workspace id> shot|layout|motion|sound <numbers...>    motions also by kind: remove <id> motion pulse
//   move <workspace id> shot|layout <number> <to>
//   setMusic <workspace id> {"start", "trim", "volume"}   trim: where in the song the video starts
//   setSound <workspace id> <sound> {"at", "volume"}      a sound effect's start and volume; its new number
//   setVideo <workspace id> {"fps": 30|60, "background": "#101010"}
//   undo <workspace id>, redo <workspace id>
//
// A command sent while Atlas is starting or reloading waits until it is ready (3 minutes at most, then
// it says so): it is never lost.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..');
/** How long a started Atlas has to open its Director (its library loads after that, `ready` waits) */
const OPEN_TIMEOUT = 60_000;
/** Longer than anything the page does (saving a video: 30 minutes) */
const CALL_TIMEOUT = 31 * 60_000;

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv.splice(at, 2)[1];
};
const to = option('--to') ?? 'user';
const out = option('--out');
const [method, ...rest] = argv;
const args = rest.map((arg) => {
  try {
    return JSON.parse(arg);
  } catch {
    return arg;
  }
});
// `picture` takes its times as one list, and then an optional {"width": ...}
const pictureArgs = (list) => {
  const last = list[list.length - 1];
  const hasOptions = typeof last === 'object' && last !== null && !Array.isArray(last);
  return hasOptions ? [list[0], list.slice(1, -1), last] : [list[0], list.slice(1)];
};
const callArgs = method === 'picture' ? pictureArgs(args) : args;

const connectionFile = path.join(repo, '.director', `${to}.json`);
const connection = () =>
  fs.existsSync(connectionFile) ? JSON.parse(fs.readFileSync(connectionFile, 'utf8')) : undefined;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One command; undefined when no Atlas answers */
async function call(name, callArguments = []) {
  const { port, token } = connection() ?? {};
  if (port === undefined) {
    return undefined;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/call`, {
      method: 'POST',
      headers: { 'x-atlas-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ method: name, args: callArguments }),
      signal: AbortSignal.timeout(CALL_TIMEOUT),
    });
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Until a Director other than `before` (a token) has written its connection, at most `OPEN_TIMEOUT` */
async function opened(before) {
  const until = Date.now() + OPEN_TIMEOUT;
  while (Date.now() < until) {
    const now = connection();
    if (now !== undefined && now.token !== before && (await call('whoAmI'))?.ok) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

/** The user's Atlas started by Windows (WMI), so that it is no part of this command or its shell */
function launch() {
  const electron = path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe');
  const bundle = path.join(repo, 'build', 'main.bundle.js');
  const quote = (text) => text.replace(/'/g, "''");
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ ` +
        `CommandLine = '"${quote(electron)}" "${quote(bundle)}"'; CurrentDirectory = '${quote(repo)}' }; ` +
        `exit $r.ReturnValue`,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return result.status === 0;
}

const commands = {
  start: async () => {
    if (to !== 'user') {
      return { ok: false, error: 'The hidden copy is started with scripts/dev/hidden.js' };
    }
    if ((await call('whoAmI'))?.ok) {
      return call('ready');
    }
    // A connection left by an Atlas that ended without quitting
    fs.rmSync(connectionFile, { force: true });
    if (!launch()) {
      return { ok: false, error: 'Windows did not start Atlas' };
    }
    if (!(await opened(undefined))) {
      return { ok: false, error: `Atlas did not open within ${OPEN_TIMEOUT / 1000} s` };
    }
    return call('ready');
  },

  restart: async () => {
    const before = connection()?.token;
    const answer = await call('restart');
    if (answer === undefined || !answer.ok) {
      return answer;
    }
    if (!(await opened(before))) {
      return { ok: false, error: `Atlas did not come back within ${OPEN_TIMEOUT / 1000} s` };
    }
    return call('ready');
  },
};

(async () => {
  const started = Date.now();
  const isOwn = Object.prototype.hasOwnProperty.call(commands, method);
  const answer = await (isOwn ? commands[method]() : call(method, callArgs));
  const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
  if (answer === undefined) {
    console.error(`No Atlas (${to}) answers: node scripts/dev/atlas.js start`);
    process.exit(1);
  }
  // A picture (`picture`, `photos`, `cuts`, `contact`, `soundPicture`) comes as data: into the file given
  if (answer.ok && typeof answer.result === 'string' && answer.result.startsWith('data:image/')) {
    if (out === undefined) {
      console.error(`${method} needs --out <file>`);
      process.exit(1);
    }
    fs.writeFileSync(out, Buffer.from(String(answer.result).split(',')[1], 'base64'));
    console.log(JSON.stringify({ ok: true, result: path.basename(out), took }));
  } else {
    console.log(JSON.stringify({ ...answer, took }, null, 2));
  }
  process.exit(answer.ok ? 0 : 1);
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

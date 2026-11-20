# The Director: making workspace videos quickly, safely

A small, limited helper for making a workspace and its video out of a tag or a collection: laid out,
cut to the beat of a song, varied on the fly, saved at a size a phone can show. For Claude to drive while
working with the user, and the same parts as buttons for the user.

## Why

Making the first demo video took far longer than the work itself (2026-10-22):

- every call through the debugging port waited out a timer of up to 15 minutes that was never cleared
  (the script lived on long after Atlas had answered);
- the scripts were thrown away after each use (`tmp-*`) and written again, and the hidden copy of the app
  booted anew for every check (about 30 s);
- a song could only be added through the file dialog, so its beats were found outside the app;
- a video was some 25 separate calls with fixed waits in between, and its shots were worked out by hand;
- driving the app needed the debugging port, so the user's Atlas was restarted (a library of tens of
  thousands of images to load) every time;
- the screensaver started while the user was away and throttled the window.

## Decisions (user, 2026-10-22)

- **A token channel, not the debugging port.** Chromium's debugging port lets anything on the machine run
  any code in Atlas (which has Node in its window), so it is **never** opened on the user's Atlas. The
  Director is a channel that only knows the commands below. Only the hidden copy opens a debugging port,
  on a random port, while it runs.
- **Neither is ever in a build that is shipped** (CLAUDE.md, "The Director channel and the debugging
  port"). Every commit is checked for it.
- The helper is **limited**: it makes workspaces of tags and collections, arranges and varies them, cuts
  their video to the beat, and saves it. It never looks at the user's folders, never returns a path, and
  keeps to the read-only rules (CLAUDE.md, Rule 1).
- **Music is always the user's choice**, from `audio/` in the repository, which they fill. Claude asks
  which song every time and reminds them to put it there.
- **Exports are phone-sized** by default (720 × 1280, at most about 26 MB: the phone link of the Claude
  app takes up to 30 MB), full size on request.

## The parts

### 1. The channel (`src/director/main.ts`, main process)

Started from `src/main.ts` only behind `process.env.NODE_ENV === 'development'` and `!app.isPackaged`:

- an HTTP server on `127.0.0.1`, port chosen by the system, one route (`POST /call`);
- a random token for every start, written with the port to `.director/user.json` (or `hidden.json` for
  the hidden copy) in the repository, git-ignored, removed on quit. A call without the token, or with a
  `Host` other than `127.0.0.1`, is refused (403); the token is compared in constant time;
- `whoAmI` and `songs` are answered there (`songs` lists `audio/` and nothing else); `music` is checked
  against that list, `save` gets `demo/` (made if needed) and answers with the file name only;
- every other command, if it is in the fixed list, goes over IPC (`src/director/channels.ts`) to the page;
- while commands come, the window is not throttled and the screensaver is held off for two minutes
  (`UiStore.holdScreensaver`).

### 2. The commands (`src/frontend/director/index.ts`, the page)

Installed from `src/renderer.tsx` behind the same development check. Each takes plain names and numbers,
never code, and calls the stores and entities the buttons call:

| Command | What it does |
|---|---|
| `tags`, `collections`, `workspaces` | Names, and how many photos each has |
| `create <name> {"tag": …} \| {"collection": …}` | A new workspace of those photos (searched like the gallery), opened |
| `arrange <id> columns\|rows\|grid [count] [gap]` | **Never a row or column of a single photo**; answers the count per line |
| `shuffle <id> <seed>` | The same arrangement with the photos in another order (one undo step) |
| `title <id> <text> [line] [colors]` | A title, a line under it, and a sheet behind everything |
| `video <id> [9:16\|4:5\|1:1\|16:9]` | Starts the video, in that format |
| `layout <id>` | The arrangement now, as the next layout of the video |
| `songs` | The file names in `audio/` |
| `music <id> <file name>` | That song under the video, its beats found as the Music lane's + does |
| `end <id> [seconds]` | Where the video ends; none: at the end of its camera again |
| `waves <id> [strength]` | A wave rolling through the photos on every swell of its song (`wavesToTheMusic`) |
| `edit <id> cuts\|flow\|mixed <seed>` | Shots, layouts and motions on the beats; another seed is another edit |
| `save <id> phone\|full` | The video into `demo/` as a new file |
| `picture <id> <times…> [{"width": 540}]` | Small frames of the video side by side (`width`: 120 to 1080, 180 by default), a JPEG for Claude to look at |
| `cuts <id> [{"width": 360, "from": 1}]` | Each cut side by side: the last moment of a shot and the arrival of the next, labelled `n\|n+1` with its time; the first and last frames too; 32 a sheet, `from` a shot to page on |
| `contact <id> [{"width": 360, "from": 1}]` | Each photo alone and whole, numbered as `timeline` numbers it, to judge focus, subject and light; 32 a sheet, `from` a photo to page on |
| `soundPicture <id> [from] [to]` | The song's loudness, beats and swells, and the motions in time: a PNG to look at |
| `state <id>` | Photos, frame, end, layouts, shots, motions by kind, wave crests, song, swells |
| `reload` | The window loaded again (a change to the page is then in it); answers once it is ready |

**Editing a video** (`src/frontend/director/edits.ts` checks every value before anything changes, tested in
`tests/director-edits.test.ts`). Photos, shots, layouts and motions are numbered from 1, as `timeline` lists
them; **each command is one change to undo** (`rememberVideo`, and `isContinuing` on `moveBlock` and
`removeBlock`), so `undo` takes back exactly one command:

| Command | What it does |
|---|---|
| `timeline <id>` | Every shot (when, how long, arrival, stay, which photos it shows), layout and motion (which photos), and `warnings`: weak spots by shot (`timelineWarnings`: shorter than a beat, a photo repeated from a shot where it was alone, a text cut off, a first shot showing nothing, more than four quick shots in a row) |
| `photos <id> [time]` | Everything at that moment, each photo's number on it and the shot outlined: to choose by number |
| `setShot <id> <n> {…}` | What it shows: `photo` (filled; with `room`, all of it), `photos`, `title`, `all` or `frame`; then `zoom`, `move`; and `length`, `arrival`, `arrivalTime`, `stay`, `easing` |
| `addShot <id> <after> {…}` | A new shot after shot `after` (0: the first), the same changes; the end set by hand stays |
| `addMotion <id> <kind> <photos\|all> <start> {…}` | A motion of those photos; `length`, `strength`, `speed`, `stagger` |
| `setMotion <id> <n> {…}` | Its `kind`, `photos`, `start`, `length`, `strength`, `speed`, `stagger` |
| `setLayout <id> <n> {…}` | Its `length`, `transition`, `easing` |
| `remove <id> shot\|layout\|motion <n…>` | Those removed; motions also by kind (`remove <id> motion pulse`) |
| `move <id> shot\|layout <n> <to>` | Shot or layout `n` becomes number `to` |
| `setMusic <id> {…}` | The song's `start` in the video, `trim` (where in the song the video starts), `volume` |
| `setVideo <id> {…}` | `fps` (30, 60) and `background` (a CSS colour) |
| `undo <id>`, `redo <id>` | As Ctrl+Z and Ctrl+Y |

The answers name photos by number, never by file. `picture` and `photos` look the surface up only after the
images are decoded: right after a reload the surface could be replaced meanwhile ("reading 'viewport'").

### 3. The scripts (`scripts/dev/`, kept)

- `atlas.js`: the client. Reads the connection file, sends one command, prints the answer and exits at
  once. `--to hidden` talks to the hidden copy, `--out` is where `picture` goes.

  ```bash
  node scripts/dev/atlas.js create "<workspace name>" '{"tag": "<tag>"}'
  node scripts/dev/atlas.js music <id> "<song in audio/>"
  node scripts/dev/atlas.js edit <id> cuts 3
  node scripts/dev/atlas.js picture <id> 0 2 4 6 8 10 --out tmp-edit.jpg
  node scripts/dev/atlas.js save <id> phone
  ```
- `hidden.js start|stop|status`: the hidden, off-screen copy of the development build
  (`hidden-entry.js` hides every window), its own profile `.dev-hidden-profile/` (git-ignored), its
  debugging port on a random port. Started once and kept running between checks; `stop` ends it and its
  ExifTool.

### 4. The guards

- `tests/director-guard.test.ts`: the two starts are behind the development checks, nothing else in
  `src/` reaches the Director, and nothing opens a debugging port.
- `scripts/check-production-bundle.js`, run by `yarn production` (and so `yarn build` and both
  workflows): fails if the built code has any trace of the Director or the debugging port. It fails on the
  development build, as it should.

### 5. The rules, tested in `common/`

- `common/workspace.ts`: `evenGridColumns` and the `even` option of arranging, so no row or column holds a
  single photo; `common/core.ts`: `shuffled` with `seededRandom`.
- `common/auto-edit.ts`: from the beats, the photos (where they are in each layout), a style and a seed,
  the camera stops, the layouts' lengths and the motions. The same seed gives the same edit.

### 6. For the user, in the app

- Arrange menu: **Shuffle** (Alt+R).
- Video tab: **Cut to the beat** (a style; every press another seed), once there is a song.
- Export tab: **Size**, Phone (default) or Full.

## Steps

1. Arranging without single photos, Shuffle, with tests and the Arrange menu (done).
2. `common/auto-edit.ts`, Cut to the beat, with tests and the Video tab (done).
3. Phone size in Export; `WorkspaceStore.addMusic` (done).
4. The channel, the commands, `scripts/dev/`, the guards (done; tried on the hidden copy: refuses a wrong
   or malformed token, a foreign host, unknown commands and songs outside `audio/`; errors never carry a
   path; `picture` takes 32 times at most, `arrange` clamps its count and spacing).
   Reviewed by an agent (2026-10-23); its findings fixed: layouts in an edit each get a section of their
   own (the ones that do not fit go after the end), the photos filmed are those of the layout on screen,
   `hidden.js stop` finds its processes by profile instead of a kept process id, `title` is
   `ClientWorkspace.addTitle` (one undo step), arranging tries counts one at a time.
5. Try it on the user's Atlas (done, 2026-10-23): a workspace of a tag, an arrangement, a title, a 9:16
   video and three edits with a picture of each in 3.5 s from the first command. Then the first request
   of the user's own: a wave video of a tag to a sea sound, saved at phone size (19.5 MB, 13 s to save).

## What still slows it down (the wave video, 2026-10-23)

The commands themselves were fast (every one 0.2 s, a picture under 1 s, saving 13 s). The time went into
what the Director could not do yet, and each gap cost a change, a test run, a build and a restart:

1. **A new effect is new code.** There was no wave motion and no way to time anything to a sound without
   a beat: `wave` (`video-motion.ts`), `findSwells` (`beats.ts`), `wavesToTheMusic` and two commands had
   to be written and tested first. Expected for a new kind of effect; the list of motions and of what the
   music knows will keep growing this way.
2. **Every new command restarts the user's Atlas.** The main process keeps its own list of commands
   (`PAGE_COMMANDS`), so adding one to the page is not enough: three restarts of a library of tens of
   thousands of images in this trial. The page refuses unknown commands itself; the main process could
   forward any name that is a plain word and leave the list to the page (still development only, still
   only the page's fixed functions). Asked about before changing, as the rules say.
3. **No reload.** A change to the page (most changes) needs only a reload of the window, but the Director
   cannot reload it, so a restart was used instead. A `reload` command would take seconds, not a restart.
4. **A new field was dropped on the way to the database.** `musicFromRow` reads a stored song field by
   field, so `swells` vanished at the restart and the song had to be added again. Every reader of a stored
   row (`videoFromRow`, `musicFromRow`, `workspaceFromRow`) has to learn a new field in the same change,
   with a round trip in `tests/video.test.ts`: now in place for `swells`.
5. **Rules made for the buttons surprised the Director.** The rule against a last row of one photo turned
   6 columns into 4 for 52 photos (a divisor), a grid too tall for 9:16 whose ends were cut off; the frame
   of a started video stayed where it was after the photos moved. Both fixed (`evenGridColumns` keeps the
   count asked for when its last row is half full; `video` fits the frame). Only the picture showed them:
   **look at a `picture` before every save**.
6. **No way to start over.** There is no command to delete or rename a workspace, so the trial reused the
   one it had made (making it again would have given two of the same name). Deleting stays the user's
   (it asks first in the app); a `rename` or a `create` that replaces its own earlier trial would do.
7. **Sound cannot be checked.** Claude cannot hear the result: whether the waves land on the swells rests
   on `findSwells`, tested on made-up surf only. A picture of the song's loudness with its swells and the
   waves marked on it (a `picture` of the music lane) would make the timing something to look at.
8. **`state` says too little**: no swells, no motions by kind, nothing of the frame. Each question about
   them needed a picture or code.
Built since (2026-10-23), the user asked for those that make the most difference:

- 2: the main process forwards any plain name (`COMMAND_NAME`), and the page's list is the only one (it
  takes only its own commands, never `constructor` and the like). A command added to the page needs a
  reload, not a restart.
- 3: `reload` loads the window again and answers once its Director answers again (the library loaded).
- 7: `soundPicture <id> [from] [to]`: the song's loudness, beats and swells over the video, every motion
  as a bar with a wave's crest marked, the seconds and the end.
- 8: `state` says the frame, the end, the motions by kind, the wave crests and the swells.

9. **The build and test cycle**: about 25 s of webpack and up to a minute of jest per round, several
   rounds. Running only the tests of the files changed (`yarn jest tests/video.test.ts`) until the end
   saves most of that.

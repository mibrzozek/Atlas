# Atlas

Atlas is a personal fork of [Allusion](https://github.com/allusion-app/Allusion) 1.0.0-rc.10 (GPL-3.0), a desktop app
for browsing, tagging and searching a library of images. Electron 21, React 18, TypeScript, MobX, Dexie (IndexedDB),
Rust/WASM for the masonry layout.

## Finding your way

- **The graph first.** `graphify-out/` (git-ignored) holds a knowledge graph of all code and docs. For "where is X",
  "what uses Y", "how does Z work": `graphify query "<question>"`, `graphify path "A" "B"`, `graphify explain "X"`,
  and `graphify-out/GRAPH_REPORT.md` for the map of communities. After larger changes, `/graphify . --update`.
  `.graphifyignore` keeps the app's images out. A fresh clone has no graph: `/graphify .` builds it.
- **The details: `docs/code-notes.md`.** How every part works, what was measured, and why (the screensaver,
  workspaces, video mode, collage, tags and collections, the inspector, the status footer...). Read the part
  you are about to change before changing it.
- Plans and status: `docs/workspaces-roadmap.md`, `docs/workspace-video-plan.md`, `docs/video-text-plan.md`,
  `docs/director-plan.md`, `docs/installer-plan.md`.

## Rule 1: the image files are sacred

The user's photos are irreplaceable. **Atlas is read-only towards them, and so is all work done on Atlas.**

- Never modify, move, rename, overwrite or delete a file inside the user's image folders ("locations"). Not from
  app code, a script or a shell command, not "temporarily", not to test something. Reading them is fine.
- `SOURCE_FILES_READ_ONLY` in `common/config.ts` blocks writing metadata (`ExifIO.writeTags`/`writeData`), moving
  to the trash (`onTrashFile`, `UiStore.openMoveFilesToTrash`) and moving files by drag and drop (`handleMove`).
  Do not flip it, weaken those guards, or add a code path that writes into a location.
- New file-system features write somewhere else (thumbnail directory, app data, a folder the user picks) and never
  overwrite an existing file there either (`writeNewFile` in `common/export.ts`).
- A small image is its own thumbnail (`thumbnailPath === absolutePath`): every thumbnail writer refuses when output
  equals input (`ImageLoader.ensureThumbnail`, `thumbnailGenerator.worker.ts`, `image/util.ts`). Keep those guards.
- Allowed because they only create new, numbered files: pasting an image, dropping one from outside, the browser
  clipper. Ask before extending these.
- The folder creator (`common/folder-create.ts`) only does a plain `fse.mkdir` per single name, which fails when it
  exists: no recursive mkdir, rename, delete or clean-up. `tests/folder-create.test.ts` holds it to that.
- Test anything destructive on a path that does not exist or on files you generated inside this repo.

## Rule 2: stay inside this repository

Only change things inside this project folder. Do not install software, edit system settings, or write elsewhere
on the machine without asking. Never write to `%APPDATA%\Allusion` (the user's original Allusion library).
Temporary scripts go in the repo root as `tmp-*` and are deleted when done.

## Working with the user

- No visible test windows on their screen without asking; never always-on-top in a test.
- The running Atlas is theirs: do not close it. Before launching or killing anything, list the running
  `electron.exe` processes (they often have Atlas or `oobe` open). Never delete `.oobe-profile/`.
- Measure before and after instead of reasoning from the code, and say plainly what was not verified. When they
  say something looks wrong and the code says it is fine, look at the real thing early (ask first).
- `origin` is their public fork (`mibrzozek/Atlas`), `upstream` the original. Before any commit, check that no
  library folder names, shoot names or machine paths are included.

## Changelists (CLs)

Work is tracked and reviewed with the owner's private `cl-review` tool (kept outside the repo; `cl` runs it for
the folder you are in). Claude splits the work into small CLs (a CL is a commit) on its own, without announcing
each one:

- Each CL does one thing, builds (`yarn webpack --config ./webpack.dev.js`) and passes the full test suite
  (`yarn jest`) before it is committed. Notes-only and tiny changes can go in as they are.
- Size: a CL is a reviewable feature step, not a single line. Group changes that belong together into one CL: a
  feature and its tests, styles and notes (e.g. the start-up splash: its phases in `common/startup.ts`, the store,
  the intro component, `startup.scss`, the setting and the tests) go in one CL. Don't split one feature into
  several CLs just because it touches several files. Split only where a piece can stand alone and be reviewed on
  its own.
- Claude commits each CL as soon as it is finished, and only once the whole group of changes is done, not after
  each file. The owner reviews them in the tool and asks for changes. The tool is the review step, so Claude
  doesn't run a separate reviewer per CL unless the owner asks.
- Commit messages: a short imperative subject saying what it does for the user, a body when it needs one. No
  Claude attribution lines (no `Co-Authored-By`, no "Generated with").
- After any code change, Claude ends its reply with a `cl` command the owner can run.
- Push only when the owner says so, but remind them to push as soon as the tests pass and there are commits to send.
- Branches are short-lived, one per feature or experiment, named for that one thing, aiming to merge in a day or
  two. Split bigger work into stages that each work alone. A fix goes on master once, then master is merged into any
  open branch. Delete a branch once merged. Tiny, safe changes can go straight to master.
- Master always works: merge only with the full test suite passing and any changed screens looked at.
- A test that fails at random is a bug: fix it right away.
- Each CL updates this file itself when it changes something this file describes.
- **Who does what:** the main conversation (Opus) plans, splits work into CLs and checks results; subagents on
  Haiku (high effort) carry out the plans and report back. Keep the main conversation's token use low.
- **Videos:** ask **which song** every time and remind them to put it in `audio/`. Videos go to `demo/`, phone size
  (720 × 1280, under about 26 MB) unless asked. Both folders are git-ignored and never committed.

## The Director and the debugging port: development only, never shipped

Claude drives the user's Atlas through the **Director** (`docs/director-plan.md`): a local server with a random
token in `.director/` (git-ignored) that runs only the page's fixed list of commands (`src/frontend/director/index.ts`)
with the stores and entities, as the buttons do. It never reads the user's folders and never returns a path.
`node scripts/dev/atlas.js <command>` sends one and prints the answer.

- **Start, restart, reload only through it:** `atlas.js start` (Windows starts Atlas, so it is no part of a shell
  of Claude's), `atlas.js restart` (Atlas starts itself again; for changes to `src/main.ts` or `src/director/`),
  `atlas.js reload` (everything else). Each answers once Atlas is ready. Never start, close or wait for Atlas from a
  shell command, and give every wait an end: both once hung the session and took the user's Atlas down with it.
- A new or changed command needs only `reload`: the main process forwards any plain name (`COMMAND_NAME`), the
  page's `commands` (own properties only) are the list.
- Look before saving: `picture` (frames of the video), `soundPicture` (the song's loudness, beats, swells and every
  motion), `state`.
- Making, remaking or judging a video: follow the `atlas-director` skill (`.claude/skills/atlas-director/`):
  cast every photo, write a treatment against the song, place shots by hand, review real frames. The
  auto-edit is only a scaffold. The owner's feedback goes into its `references/taste.md`.
- Change a video by command, not by changing code: `timeline` and `photos` number everything, `setShot`, `addShot`,
  `setMotion`, `remove`... change one thing each, one undo step each (list in `scripts/dev/atlas.js`). Ask
  whether a change is for this video or for every edit (`common/auto-edit.ts`) before changing the rule.
- Chromium's **debugging port** runs any code in Atlas: **never** on the user's Atlas. Only the hidden copy
  (`scripts/dev/hidden.js start|stop`, its own profile `.dev-hidden-profile/`) opens one, on a random port; stop it
  when the checks are done.
- **Neither may ever ship.** Both are behind `process.env.NODE_ENV === 'development'` (and `!app.isPackaged` in main).
  `yarn production` fails if any trace is in `build/` (`scripts/check-production-bundle.js`); `yarn build` and both
  workflows run it; `tests/director-guard.test.ts` keeps the two starts behind the checks.
- **Before every commit and push**, check the diff for `remote-debugging`, `director` and the development checks,
  and say in the summary that they are still development only. A change to them is asked about first.

## How the code should read

Write to the standard of David Heinemeier Hansson, and in his style:

- **Clarity over cleverness.** Pick the name that makes a comment unnecessary; a comment says why, not what.
- **Conceptual compression.** One concept, one name, one home. Before adding a helper, find the place that already
  answers the question and put it there.
- **Rich models, thin glue.** Behaviour lives on the entity or store it is about, not in the component that needs it.
- **No speculative abstraction.** Extract on the second real use. Three similar lines beat a premature framework; a
  duplicated rule does not.
- **Delete.** Code no longer reached goes in the same change that made it unreachable.
- **Small, whole steps**, each leaving the app working; **convention over configuration** (stores, entities,
  `common/` for pure logic with a test); awkward code is a defect, not taste.

## Designing UI

The user has sent back new UI several times for spacing, wrapping and alignment. **Plan a new panel, tab, dialog or
row of settings before building it:**

- **Reuse before making** (`widgets/`, `resources/style/controls/`, the workspace's dialogs and toolbars). Global
  rules reach new elements: `[role='radiogroup']` adds a gap; `[role='tab']`/`[role='tablist']` come from settings.
- **Plan the rows.** Labels line up, controls of one kind have one width, buttons sit together at the end of their
  row, nothing wraps inside a field, no auto-fill grids.
- **Every zoom:** sizes in rem; check at 100%, 125% and 150% (`webFrame.setZoomFactor` in the hidden copy) and at a
  device scale of 1.3 (the user's screen). A screenshot is the check, not the CSS.
- **Theming:** only the theme's variables (`--background-color`, `--accent-color`, ...), checked light and dark.
  `color-mix()` is newer than this Chromium.
- **Usability:** short tooltips that say what it does, keyboard and focus work, nothing cut off, nothing jumps when
  a value changes. Messages go to the status footer (`AppToaster.show`), never a corner of their own.
- **Shortcuts:** anything used often gets a key in `hotkeyMap` (shown under Settings, Shortcuts) and in its tooltip.
- **"Locations" are "Sources"** in everything the user reads; the code keeps `location`.

## Commands

Node 20 is a per-user install in `%LOCALAPPDATA%\Programs\nodejs`: add it to `PATH` in each shell first.

| Task | Command |
|---|---|
| Build once (about 25 s) | `yarn webpack --config ./webpack.dev.js` |
| Watch build | `yarn dev` (often not running: compare the time of `build/renderer.bundle.js` with your edit) |
| Tests | `yarn jest` (one file while working: `yarn jest tests/video.test.ts`) |
| Lint one file | `yarn eslint --fix <file>` |
| Run as a new user | `yarn oobe` (throwaway profile `.oobe-profile/`) |

- The webpack build is the real type check (`tsc --noEmit` fails on old type-lib conflicts). Nine prettier errors
  in untouched upstream files are known; do not chase them.
- Dev builds keep their data in `%APPDATA%\Electron`.

## Checking things

From least to most intrusive (details in `docs/code-notes.md`, "Verifying in the real app"):

1. Pure logic in `common/` with a jest test. Fastest, and it stays.
2. The hidden copy (`scripts/dev/hidden.js start`): the whole app off-screen with its own profile, driven over its
   debugging port with `node --experimental-websocket`. It paints, so screenshots and transitions work; it has no
   real screen. Reload its page after a build. Make sample pictures in its profile, never use the user's.
3. The user's Atlas through the Director; the real screen only after asking (delete screenshots afterwards).

- Test drags and hovers with real input (`Input.dispatchMouseEvent`, intercepted drags), not events made in the
  page: those passed three times while the real thing failed.
- Wait for animations to end (`getAnimations().length === 0` for 300 ms), not fixed sleeps. Never give an evaluate
  call an open end. Restore anything changed in the user's app.
- Stop test instances by `electron.exe`/`exiftool.exe` name AND profile path (ExifTool by its executable's path).

## Traps that cost time before

- **Do not rename `DB_NAME = 'Allusion'` or the `Allusion_*` storage keys**; the database schema stays at version 8
  (9 would stop backups restoring into Allusion; ask first). Workspaces have their own database, `Atlas_Workspaces`.
- **Whole-row writes overwrite each other**: bulk updates must also update the loaded `ClientFile`s and never run
  alongside another bulk update. **Readers of stored rows** (`videoFromRow`, `musicFromRow`, `workspaceFromRow`)
  must learn every new field in the same change, with a round-trip test: a new field was silently dropped once.
- `width`/`height` are the displayed dimensions (swapped for sideways Exif). `ImageDecoder` with a desired size
  already rotates: do not rotate again. Close `ImageBitmap`s and video frames, or memory balloons.
- **Never read an observable array item by item** (`for...of`, `[i]`, spread): the dev build checks every read.
  Take `.slice()` once. MobX `tags`/`isViewed`/`collectionsOf` are deliberately not actions.
- Never `instanceof HTMLElement` on an event target in shared widgets (other windows' elements fail it); use
  `typeof target.matches === 'function'`.
- The covered main window is throttled: anything running under the screensaver uses a screensaver window's timers.
- Masonry: `resize` before `compute`. ExifTool starts in the background: every `ExifIO` method awaits `initialize()`.
- Changes to `src/main.ts` need a restart of Atlas; everything else a reload.
- **Never put a script inside a shell command** (no heredocs, `node -e`, `sed -i`): write a `tmp-*.js`, run it,
  delete it. `sed -i` also strips the CR of CRLF files; several files are CRLF, keep them so.
- Parallel temporary files need unique names.

## Deliberately not rebranded

The web clipper extension (`src/clipper/web-extension`), upstream links, and the "fork of Allusion" credit in About
(GPL-3.0). The Atlas icon's files are made by `scripts/generate-icons.js` (`resources/logo/atlas/`; change
`atlas-mark.svg` with it). The README screenshots show generated pictures, never the user's photographs.

## Known open items

- Workspaces and videos: "Next steps" in `docs/workspaces-roadmap.md` and `docs/workspace-video-plan.md`; not yet
  checked whether a sideways photo comes out upright in a saved video.
- Open findings of the review of 2026-10-23: `docs/code-notes.md`, "Open review findings". Read them before
  changing motions, the Director or the video panel.
- "Date taken" sort: not yet. Camera raw files (CR2/CR3) are not recognised. PSD/EXR thumbnails run on the main
  thread. The whole library is loaded as `ClientFile`s (36,600 images: 3.3 s for "all images", about 320 MB).
- The crash report link, the update dialog's release page and `dev-app-update.yml` still point at upstream.
- Electron 21 gets no security updates and the renderer has Node integration: local files only, no remote content.

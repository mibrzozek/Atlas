# Atlas

Atlas is a personal fork of [Allusion](https://github.com/allusion-app/Allusion) 1.0.0-rc.10 (GPL-3.0), a desktop app
for browsing, tagging and searching a library of images. Electron 21, React 18, TypeScript, MobX, Dexie (IndexedDB),
Rust/WASM for the masonry layout.

## Rule 1: the image files are sacred

The user's photos are irreplaceable. **Atlas is read-only towards them, and so is all work done on Atlas.**

- Never modify, move, rename, overwrite or delete a file inside the user's image folders ("locations"). Not from
  app code, not from a script, not from a shell command, not "temporarily", not to test something.
- Reading them is fine: `stat`, decoding, ExifTool in read mode.
- The app enforces this with `SOURCE_FILES_READ_ONLY` in `common/config.ts`. It currently blocks:
  - writing metadata (`ExifIO.writeTags`, `ExifIO.writeData`): tag export to files, the inspector's Exif editor
  - moving files to the trash (`onTrashFile` in `src/main.ts`, `UiStore.openMoveFilesToTrash`)
  - moving files between folders by drag and drop (`handleMove` in `LocationsPanel/useFileDnD.ts`), which could
    also replace and permanently delete another file
- Do not flip that switch, weaken those guards, or add a new code path that writes into a location. Any new
  feature that touches the file system must write somewhere else (thumbnail directory, app data, a folder the user
  explicitly picks as an export destination) and must never overwrite an existing file there either.
- Thumbnails: a small image is its own thumbnail (`thumbnailPath === absolutePath`). Every thumbnail writer must
  refuse when output path equals input path. The guards are in `ImageLoader.ensureThumbnail`,
  `thumbnailGenerator.worker.ts` and `image/util.ts`; keep them.
- Still allowed, because they only create new files and never overwrite (names get a numeric suffix): pasting an
  image from the clipboard, dropping an image from outside the app, and the browser clipper. Ask before extending
  these.
- The folder creator (`containers/FolderCreator.tsx`, the + in the top bar) makes new, empty, numbered folders in
  a folder the user opens, which may be inside a location. Its only write is `createFolders` in
  `common/folder-create.ts`: a plain `fse.mkdir` per single folder name, which fails when the name exists, so
  nothing is ever replaced. Keep it that way: no recursive mkdir, no rename, no delete, no clean-up after a
  failure. `tests/folder-create.test.ts` holds it to that. The folder listing it reads stays in memory only.
- To test anything destructive, use a path that does not exist or files you generated yourself inside this repo.

## Rule 2: stay inside this repository

Only change things inside this project folder. Do not install software, edit system settings, or write elsewhere
on the machine without asking. In particular never write to `%APPDATA%\Allusion` (the user's original Allusion
install and library). Put temporary scripts in the repo root as `tmp-*` and delete them when done.

## Working with the user

- Do not open visible test windows on their screen without asking; use a hidden Electron window
  (`show: false`) for decode/memory timing. Never use always-on-top in a test.
- The running Atlas window is theirs. Do not close it. Reloading it (Ctrl+R equivalent) is fine when verifying.
  Before launching, wiping a profile or killing anything, list the running `electron.exe` processes: the user
  often has Atlas or an `oobe` session open. Never delete `.oobe-profile/`; use a folder of your own.
- Measure before and after instead of reasoning from the code, and say plainly what was not verified.
- When the user reports that something looks wrong and the code says it is fine, look at the real thing early.
  Twice a long chain of hidden tests "proved" a fix that the real screen then contradicted (the instant fade,
  the taskbar over the screensaver). Ask for a go-ahead and take the real measurement instead of a third proxy.
- Ask before committing or pushing. `origin` is the user's public fork (`mibrzozek/Atlas`), `upstream` is the
  original project. Before any push, check that no library folder names, shoot names or machine paths are included.

## Commands

Node 20 is a per-user install in `%LOCALAPPDATA%\Programs\nodejs`; add it to `PATH` in each shell first.

| Task | Command |
|---|---|
| Watch build | `yarn dev` (usually already running in a terminal tab; it rebuilds on save) |
| Run the app | `yarn start`, or `.\node_modules\electron\dist\electron.exe ./build/main.bundle.js` |
| Run as a new user | `yarn oobe` (empty throwaway profile in `.oobe-profile/`; `yarn oobe --keep` reuses it) |
| Tests | `yarn jest` |
| Lint one file | `yarn eslint --fix <file>` |

- `atlas` and `oobe` also work from any terminal: two `.cmd` files next to `node.exe` that point at this folder.
- The watch build is often NOT running (its terminal tab gets closed). Compare the time of
  `build/renderer.bundle.js` with your edit, and run `yarn webpack --config ./webpack.dev.js` once (about 20 s)
  when it is stale. A "fix" that was never built cost a round trip more than once.
- The webpack build is the real type check. Standalone `tsc --noEmit` fails on type-lib conflicts that
  predate the fork.
- Nine prettier errors (`typeof X` parenthesising) exist in untouched upstream files; do not chase them.
- Changes under `src/main.ts` need a full app restart; everything else only a window reload.
- Dev builds keep their data in `%APPDATA%\Electron`, separate from an installed app.

## Verifying in the real app

Start Atlas with `--remote-debugging-port=9333`, then evaluate JavaScript in the main window over the Chrome
DevTools Protocol from Node (`node --experimental-websocket`, `Runtime.evaluate` with `awaitPromise`). The MobX
root store is reachable by walking the React fiber from the element that has a `__reactContainer$…` key until
`memoizedProps.value.fileStore` exists. Node integration is on in the renderer, so `require('fs')` works there.
This is how scrolling, layout, cropping, sort order and the read-only guards were checked.

Ways to check things, from least to most intrusive:

1. **Pure logic in `common/` with a jest test.** Layout maths, rules, file helpers. Fastest, and it stays.
2. **Hidden harness** (`show: false` window, own `userData` inside the repo): decode speed, memory, workers. Load
   the built worker bundle from `build/` to test the real code. Nothing is painted, so no animations and no
   `requestAnimationFrame`: a probe that waits for a frame hangs forever.
3. **Hidden, off-screen copy of the whole app**: a `tmp-*.js` entry that hooks `Module._load` so `electron`'s
   `BrowserWindow` is a subclass forcing `show: false` and `webPreferences.offscreen: true`, then requires
   `build/main.bundle.js`; run with `--user-data-dir=<repo>\.tmp-verify-profile --remote-debugging-port=9334`
   and `TEMP`/`TMP` pointing inside that profile. It paints, so `Page.captureScreenshot` and CSS transitions
   work. Generate numbered sample images into the profile, add them as a location through the stores, tag them.
   It has no real screen: window bounds, focus and the taskbar are fake there.
4. **Transparent real windows** (`opacity: 0`, `skipTaskbar`) for real window geometry on the real monitors.
5. **The real app on the real screen** (ask first): relaunch with the debugging port and take a picture of the
   monitors with PowerShell (`System.Drawing` `CopyFromScreen`). Delete the pictures afterwards: they show
   the user's screen. To press a button in the settings window, find its DOM node through the React fiber of
   the main window (the popup's elements have another `ownerDocument`) and call `.click()`.

Probe pitfalls that cost time:

- Wait for animations to finish with `element.getAnimations({ subtree: true }).length === 0` for 300 ms, not
  with fixed sleeps: samples that drift into the next step look like layout bugs.
- When stopping a test instance, match `electron.exe`/`exiftool.exe` by name AND by the profile path. A filter
  on the command line alone also kills the shell that is running the test. `exiftool.exe` outlives a killed
  Electron and locks the profile folder.
- Restore whatever you changed in the user's running app (view, sort, criteria).
- Never give evaluate calls an open end: race them against a timeout.

## Layout of the code

- `src/main.ts`: Electron main process (windows, tray, updater, IPC handlers).
- `src/ipc/`: typed messages between main and renderer.
- `src/backend/`: Dexie database (`config.ts` has the schema versions), backups.
- `src/api/`: DTO types and the storage interface.
- `src/frontend/stores/`: MobX stores. `FileStore` (file list, sorting, export, one-time repairs),
  `LocationStore` (start-up disk scan and sync), `UiStore` (view state, preferences), `TagStore`.
- `src/frontend/entities/`: `ClientFile` etc. A `ClientFile` saves itself to the database whenever an observable
  field changes, by serialising all its fields.
- `src/frontend/image/`: loaders and thumbnail scheduling. `src/frontend/workers/`: thumbnail, folder-watch and PSD
  workers.
- `src/frontend/containers/ContentView/`: gallery (`Masonry/`), full-size viewer (`SlideMode/`), context menus.
- `common/`: shared helpers (`ExifIO.ts` wraps the bundled ExifTool, `export.ts` copies files out).
- Screensaver: `containers/Screensaver.tsx` (idle check every 5 s, a full-screen wall of the home gallery's
  thumbnails that moves one image at a time, wake on input), layout and rules in `common/screensaver.ts`
  (tested), settings tab in `containers/Settings/Screensaver.tsx`. The wall is laid out like the gallery:
  always 3 justified rows (or columns for vertical masonry) that reach every edge, 8 px gaps. To fill the
  screen exactly the tiles are up to `MAX_TILE_TRIM` (6%) off the shape of their image, shown with
  `object-fit: cover`; the user accepted that over black bands.
  System idle time comes from the main process (`GET_IDLE_STATE`, Electron's `powerMonitor`). It only starts
  when the Atlas window is the focused one. `SET_SCREENSAVER_MODE` makes the window full-screen on the
  `screen-saver` always-on-top level, and claims the top again after 250 ms and 1 s: when the settings window
  closes at the same moment ("Start it now"), Windows otherwise puts the taskbar back in front.
  Keep the tiles in a stable order in the array: React moving an element cancels its CSS transition, which
  made the fade an instant jump. The durations in the `.tsx` and in `screensaver.scss` must match.
- `wasm/`: Rust sources and prebuilt packages for the masonry layout and EXR decoding.

## Things that are easy to break

- **Do not rename `DB_NAME = 'Allusion'` or the `Allusion_*` storage keys.** Backups restore by database name; the
  user moves their library over from Allusion with Settings → Import/Export.
- **Database schema is version 8, same as Allusion.** Adding an index means version 9, after which Atlas backups
  can no longer be restored into Allusion. The user has not agreed to that; ask first.
- **Whole-row writes overwrite each other.** `backend.saveFiles` replaces complete rows, and loaded `ClientFile`s
  write their own copy back when they change. Anything that updates files in bulk must also update the loaded
  `ClientFile`s, and must not run concurrently with another bulk update (the start-up scan and the rotated-photo
  repair run one after the other for this reason).
- **`width`/`height` are the displayed dimensions**: swapped for photos with a sideways Exif orientation. The
  layout, viewer and thumbnails all rely on that.
- **`dateModified` is the file's modified date on disk**, synced during the start-up scan. It is no longer touched
  when a file is tagged. `dateCreated` is the file-system creation date, which resets when files are copied.
- **Thumbnail decoding:** `ImageDecoder` with `desiredWidth/Height` already applies Exif rotation; do not rotate
  again. `ImageBitmap`s and video frames must be closed explicitly or memory balloons.
- **Masonry layout:** always call `resize` before `compute` (the count can change while the gallery is unmounted).
- **ExifTool is started in the background, not awaited at start-up.** On Windows it unpacks itself into the temp
  folder on first use (about 4 s), which used to hold up the loading screen. Every `ExifIO` method that talks to
  the process calls `await this.initialize()` first: keep that when adding one.
- **TIFFs are converted in `tifConverter.worker.ts`** and handed over as an uncompressed BMP. Decoding them on
  the main thread froze the window for over a second, and re-encoding as PNG took about 4 s for a large scan.
  `canvas.toBlob('image/avif')` silently falls back to PNG in this Chromium.
- **The full-size viewer** animates with the thumbnail and layers the full image on top; swapping the `src` of
  the visible image mid-animation freezes it for about 200 ms.
- **Temporary files used in parallel need unique names** (a shared name once made a repair pass skip files).
- **The Bash tool mangles backslashes and some quotes in heredocs.** Write scripts with the Write tool and build
  Windows paths with `path.sep`. Several source files use CRLF line endings; preserve them.

## Deliberately not rebranded

The web clipper extension (`src/clipper/web-extension`, upstream's published extension), upstream links,
and the "fork of Allusion" credit in About (required by GPL-3.0). The Atlas icon is a blue-to-green gradient
circle: all its files are in `resources/logo/atlas/` and are generated by `scripts/generate-icons.js` (run it with
Electron; it opens no window). `atlas-mark.svg` there is the hand-written vector twin: change both together.
The welcome/splash lettering lives in `src/frontend/components/AtlasWordmark.tsx`: a large blocky "ATLAS" with a
small "of my mind" underneath, which is what the user asked for.

## Known open items

- A "Date taken" sort from Exif capture date: discussed, user said not yet.
- Camera raw files (CR2/CR3) are not recognised at all; most of the user's shoots are raw + JPEG pairs.
- PSD and EXR thumbnails, and their full-size conversion, are still done on the main thread.
- The whole library is loaded into memory as `ClientFile`s. With 36,600 images that makes "all images" take
  3.3 s (one 1 s freeze), every change of sort order about 1.2 s, and costs roughly 320 MB. Loading only what is
  being viewed is the biggest remaining performance win.
- The start-up scan of all locations runs in the renderer (about 20 s for four locations, 1.4 s of stalls) and
  competes with first-screen loading.
- The screensaver skips nothing, but uses thumbnails; PSD/EXR/Krita images without a thumbnail are left out.
- The crash "File bug report" link (`githubUrl` in `common/config.ts`), the update dialog's release page link
  (`src/main.ts`) and `dev-app-update.yml` still point at the original project.
- Electron 21 no longer receives security updates, and the renderer runs with Node integration and without
  context isolation. Acceptable for local files only; do not load remote content.

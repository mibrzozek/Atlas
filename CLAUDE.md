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
- To test anything destructive, use a path that does not exist or files you generated yourself inside this repo.

## Rule 2: stay inside this repository

Only change things inside this project folder. Do not install software, edit system settings, or write elsewhere
on the machine without asking. In particular never write to `%APPDATA%\Allusion` (the user's original Allusion
install and library). Put temporary scripts in the repo root as `tmp-*` and delete them when done.

## Working with the user

- Do not open visible test windows on their screen without asking; use a hidden Electron window
  (`show: false`) for decode/memory timing. Never use always-on-top.
- The running Atlas window is theirs. Do not close it. Reloading it (Ctrl+R equivalent) is fine when verifying.
- Measure before and after instead of reasoning from the code, and say plainly what was not verified.
- Ask before committing. Nothing has been committed since the fork; `origin` still points at upstream.

## Commands

Node 20 is a per-user install in `%LOCALAPPDATA%\Programs\nodejs`; add it to `PATH` in each shell first.

| Task | Command |
|---|---|
| Watch build | `yarn dev` (usually already running in a terminal tab; it rebuilds on save) |
| Run the app | `yarn start`, or `.\node_modules\electron\dist\electron.exe ./build/main.bundle.js` |
| Tests | `yarn jest` |
| Lint one file | `yarn eslint --fix <file>` |

- The webpack watch build is the real type check. Standalone `tsc --noEmit` fails on type-lib conflicts that
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
- **Temporary files used in parallel need unique names** (a shared name once made a repair pass skip files).
- **The Bash tool mangles backslashes and some quotes in heredocs.** Write scripts with the Write tool and build
  Windows paths with `path.sep`. Several source files use CRLF line endings; preserve them.

## Deliberately not rebranded

The web clipper extension (`src/clipper/web-extension`, upstream's published extension), upstream links, the
"fork of Allusion" credit in About (required by GPL-3.0), and the logo/icon artwork (no Atlas artwork exists yet).
The welcome/splash lettering lives in `src/frontend/components/AtlasWordmark.tsx`: a large blocky "ATLAS" with a
small "of my mind" underneath, which is what the user asked for.

## Known open items

- A "Date taken" sort from Exif capture date: discussed, user said not yet.
- Camera raw files (CR2/CR3) are not recognised at all; most of the user's shoots are raw + JPEG pairs.
- PSD and EXR thumbnails are still generated on the main thread.
- The start-up scan of all locations runs in the renderer and competes with first-screen loading.
- `package.json` still says `"license": "ISC"` (the repository is GPL-3.0) and its `repository` URL points at
  upstream, which is what a packaged build's auto-updater would use. Fix both before distributing a build.
- Electron 21 no longer receives security updates, and the renderer runs with Node integration and without
  context isolation. Acceptable for local files only; do not load remote content.

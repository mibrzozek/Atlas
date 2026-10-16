# Atlas, in brief

A short version of `CLAUDE.md`. When the two disagree, or a detail is missing here, `CLAUDE.md` is right.

Atlas is a personal fork of Allusion 1.0.0-rc.10 (GPL-3.0): a desktop app to browse, tag and arrange a library
of photos. Electron 21, React 18, TypeScript, MobX, Dexie (IndexedDB), Rust/WASM masonry.

## The rules

1. **The photos are sacred.** Never write, move, rename or delete anything in the user's image folders, from
   app code, scripts or the shell. Reading is fine. `SOURCE_FILES_READ_ONLY` (`common/config.ts`) blocks
   metadata writes, trash and moving files: keep it. New features write only to the thumbnail folder, app data
   or a folder the user picks, and never overwrite. Thumbnail writers refuse when output equals input. The
   folder creator only makes new empty folders (plain `mkdir`, fails if it exists).
2. **Stay in this repo.** No installs, no system changes, never touch `%APPDATA%\Allusion`. Temp scripts are
   `tmp-*` in the repo root, deleted afterwards.
3. **The user's running Atlas is theirs.** Do not close it (reloading is fine). List `electron.exe` processes
   before launching or killing anything; never delete `.oobe-profile/`. No visible test windows without asking,
   never always-on-top.
4. **Ask before committing or pushing.** `origin` is the public `mibrzozek/Atlas`. Before a push, check for
   library folder names, shoot names and machine paths. README screenshots use generated pictures only.
5. **Measure, don't assume.** Say plainly what was not verified. When the user says something looks wrong,
   look at the real thing early.
6. **Database schema stays at version 8** (same as Allusion) unless the user agrees. Do not rename
   `DB_NAME = 'Allusion'` or the `Allusion_*` keys.

## How the code should read

In the style of DHH: clear names over comments (comments say why); one concept, one home; behaviour on the
model or store, not in components; no abstraction before the second real use; delete what is no longer
reached; small whole steps that leave the app working; follow existing patterns (`common/` for pure logic
with a jest test).

## Commands

Add `%LOCALAPPDATA%\Programs\nodejs` to `PATH` first.

| Task | Command |
|---|---|
| Build once (the real type check, ~20 s) | `yarn webpack --config ./webpack.dev.js` |
| Watch build | `yarn dev` (often not running: check the time of `build/renderer.bundle.js`) |
| Run | `yarn start` |
| Tests | `yarn jest` |
| Lint | `yarn eslint --fix <file>` |

`src/main.ts` changes need a restart; the rest a window reload. Dev data lives in `%APPDATA%\Electron`.
Write scripts with the Write tool (the Bash tool mangles backslashes in heredocs); keep CRLF files CRLF.

## Checking work

Least to most intrusive: a jest test in `common/`; a hidden `show: false` window; a **hidden off-screen copy
of the whole app** (`tmp-*.js` that forces `show: false, offscreen: true` on every window, own profile in
`.tmp-verify-profile`, DevTools on port 9334, screenshots work); the real app on the real screen (ask first).
The MobX root store is found by walking the React fiber to `memoizedProps.value.fileStore`.

- **Test clicks, drags and hovers with real input** (`Input.dispatchMouseEvent`, intercepted drags); events
  made in the page passed while the real thing failed.
- Stop test processes by name AND profile path; `exiftool.exe` must be found by its executable path.
- Wait for animations to end, not fixed sleeps; give every evaluate a timeout; restore the user's view.

## Where things are

- `src/main.ts` main process; `src/ipc/` messages; `src/backend/` database and backups; `src/api/` types.
- `src/frontend/stores/`: `FileStore`, `LocationStore`, `UiStore`, `TagStore`, `CollectionStore`,
  `WorkspaceStore`. `src/frontend/entities/`: `ClientFile` (saves itself on every change), `Collection`,
  `Workspace`.
- `containers/ContentView/` gallery and viewer; `containers/Workspace/` workspaces; `src/frontend/screensaver/`
  and `common/screensaver.ts` the screensaver; `containers/TagManager.tsx` all tag and collection editing.
- **"Locations" are "Sources"** to the user; the code keeps `location`.

## Features worth knowing

- **Collections**: saved-search rows marked `isCollection` (no schema change, in backups).
- **Collage mode**: a hand-made order per view in `localStorage`; equal grid slots; cells in a fixed DOM order.
- **Screensaver**: one window per monitor, nothing drawn in the main window; starts when Atlas is open and the
  computer idle; while it runs use a screensaver window's timers (the main window is throttled). Only
  `transform`/`opacity` animate; images are drawn at their exact device pixels.
- **Large gallery cells** get the image drawn at their size by a worker (`SharpImages`), never the original in
  an `<img>`.
- **Ctrl + wheel** sizes thumbnails in the gallery; in a workspace it zooms the camera.
- **Workspaces** (`docs/workspaces-roadmap.md` has the status and next steps): own database `Atlas_Workspaces`,
  not in backups; images, texts and paper sheets as objects with layers; snapping, Arrange, swap, save as picture.
  Pan and zoom change one CSS transform outside React; small images are canvas tiles, far out one overview
  picture; stacking order is page order, not `z-index`. Tags, collections, folders and gallery images are
  dropped onto the surface, a tab or a panel row (`libraryDrop.ts`, `useWorkspaceDrop.ts`); an image is on
  a workspace once (its id is its file id). Keys live in `hotkeyMap`.

- **Messages and progress** only in the status footer at the bottom left (`StatusFooter.tsx`), through
  `AppToaster.show`; nothing pops up bottom right.

## Easy to break

- `width`/`height` are the displayed size (swapped for sideways Exif orientation).
- Bulk updates of files must also update loaded `ClientFile`s and never run alongside another bulk update.
- `ImageBitmap`s and video frames must be closed; Exif rotation is already applied by `ImageDecoder`.
- Masonry: `resize` before `compute`. Every `ExifIO` method awaits `initialize()` first.
- No `instanceof HTMLElement` on event targets in shared widgets (other windows' elements fail it).
- **Never read a MobX observable array item by item** (`for...of`, `[i]`, spread): in the dev build each read
  is checked and it froze sliders. Take `.slice()` once. MobX getters that panels render from must not be
  actions (actions do not track).
- Theme colours are stored as `var(--…)` (tags, texts, sheets): anything computing contrast must expect that.

## Open items

Workspace next steps (in the roadmap); a "Date taken" sort (not yet); raw files (CR2/CR3) not recognised; PSD
and EXR conversion on the main thread; the whole library is loaded into memory (36,600 images ≈ 320 MB);
the start-up scan runs in the renderer; some links still point at Allusion; Electron 21 is out of support
(local files only).

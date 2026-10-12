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
   Windows the page opens itself (settings, screensaver) are not made through that class: also wrap
   `webContents.setWindowOpenHandler` to add `show: false` and `offscreen: true` to what the app's handler
   returns, and no-op `show`/`showInactive`/`center` on `did-create-window`. Each such window is its own
   DevTools target, so real clicks can be sent to it with `Input.dispatchMouseEvent`.
   Frame times there do not show image decoding (it is off the main thread): measure megapixels decoded
   per screen and the time until images can be painted instead.
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
  Electron and locks the profile folder; its command line does not name the profile, so find it by the path
  of its executable (`Get-Process | Where-Object { $_.Path -like "<profile>*" }`).
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
- Screensaver: `containers/Screensaver.tsx` only decides when (idle check every 5 s through `GET_IDLE_STATE`,
  Electron's `powerMonitor`; only when the Atlas window is the focused one) and wakes on input. The rest is in
  `src/frontend/screensaver/`, with the rules and layout maths in `common/screensaver.ts` (tested):
  - `screens.ts`: it draws **nothing in the main window**. Every monitor gets a window of its own
    (`window.open` named `screensaver-<display id>`; the open handler in `main.ts` makes it frameless, not
    focusable, on the `screen-saver` always-on-top level, exactly over that monitor, and claims the top again
    after 250 ms and 1 s because Windows otherwise puts the taskbar back when the settings window closes at
    the same moment). The main window is never resized or made full-screen, so ending it is closing those
    windows. Do not go back to `setFullScreen`: leaving it left the user's maximized window full-screen.
    Keys go to the main window (still focused), the mouse to the screensaver windows: listen in both.
  - **The covered main window is throttled** (`visibilityState` hidden, timers once a second, later once a
    minute). Everything that runs while the screensaver is up uses the timers of a screensaver window
    (`surface.win.setTimeout`), never `window.setTimeout`. Test probes too.
  - `director.ts`: one `ImagePool` for all monitors (an image is never on two at once; the next one is
    picked from those not shown for the longest time, so nothing comes back early), `planScreens` picks what
    each monitor shows, and the monitors change in turn, never two at once.
  - `wall.ts`: with plenty of images, the wall like the gallery: 3 justified rows (or columns for vertical
    masonry) that reach every edge, 8 px gaps, moving one image at a time like a snake. To fill the screen
    exactly the tiles are up to `MAX_TILE_TRIM` (6%) off the shape of their image; the user accepted that over
    black bands. With fewer images than 1.5 times what fits (`WALL_SPARE_FACTOR`) it uses 2 rows.
  - `showcase.ts`: with only several images, one to three whole images per monitor, as large as fits, over a
    blurred glow of their colours, fading over to the next ones. With as many images as monitors they swap;
    with fewer, monitors show the same.
  - `tile.ts` and `workers/screensaverImage.worker.ts`: **sharpness**. The worker decodes the image file
    itself (not the thumbnail) and draws it at exactly the device pixels it covers; the frame and the canvas
    are snapped to whole device pixels, and at rest nothing is scaled. Every time a tile changes size it is
    drawn again at the new size. **Only `transform` and `opacity` are animated** (Web Animations API): a
    change of size is the frame scaled back to its old size with the canvas scaled the opposite way.
    Animating `width`/`height` laid out and repainted every frame, which was the stutter.
  - The screensaver windows do not get the zoom of the app, they are 1:1 with the monitor. A monitor that
    Windows scales (125%, 150%) was tested by zooming those windows.
- Tags and collections: the outliner only shows and opens them. A click on a tag opens it in the gallery
  (ctrl-click adds it to, or takes it out of, what is shown); there is no renaming, deleting or creating
  there. All editing is in `containers/TagManager.tsx` (the tag button in the top bar, the pencil in the
  panel headers). Both panels can be sorted by hand (drag; that is the stored order) or by name (display
  only, dragging is then ignored).
  A collection is a named group of tags; a tag can be in several. `stores/CollectionStore.ts` keeps them in
  the **saved-searches table** as rows marked `isCollection` ("any of these tags"), converted in
  `common/collections.ts` (tested). That avoids a schema change, puts them in backups, and Allusion shows
  them as working saved searches. `SearchStore` skips those rows. The store's `getTags`, `getCollectionsOf`
  and `isViewed` are deliberately not MobX actions: inside an action nothing is tracked, and the panels
  stopped updating.
  Per-tag image counts come from the database index (`countFilesByTag`), because the loaded files are only
  the ones shown, which at start-up is the home gallery.
  The tag list in the editing page is a tree like the side panel used to be (`TagManagerTree.tsx`): click,
  ctrl-click and shift-click select, dragging reorders and nests, double click or F2 renames, and the bar
  above it acts on the selection. It has a drag holder of its own (`TagDnDProvider`); the one in `Main.tsx`
  does not reach a dialog. The tree widget does not watch the selection: whoever renders it has to read it.
- All outliner panels are exactly as tall as their content (`fitContent` on `MultiSplitPane`); the outliner
  scrolls as a whole. The image counters live at the foot of the Locations panel (`FolderCounts.tsx`): all
  images and tagged images with a percentage, for the open folder (counted in the database with
  `countFilesInFolders`) or the whole library. "Tagged" is the search `tags notContains []`.
- Collage mode (`FileStore.isCollageMode`, toolbar button): the gallery shows the order made by hand for the
  current view instead of the sort order. The order is a list of image ids in `localStorage` under
  `Atlas_CollageOrder:<view>`, one per tag/folder/search, for views of up to 5,000 images; logic in
  `common/collage.ts` (tested), drag and drop in `ContentView/collageDnD.ts`. Not in the database, so not
  in backups. Outside collage mode, dragging an image still starts an export drag out of the window.
  The gallery cells have `contain: strict`, which clips anything drawn outside them: the marker for where a
  dragged image lands is an element of its own, appended to the gallery and positioned by measuring.
  While collage mode is on the gallery uses the grid layout whatever the view is set to, with every image
  shown whole inside a slot of the same size: a move or a switch then changes nothing but the images
  involved (measured: 34 other images did not move a pixel, scroll position unchanged). After a reorder the
  renderer must not run its usual "scroll the first image to the top" (`FileStore.lastCollageReorder`).
  The cells are drawn in a fixed DOM order (sorted by id) because React moving an element cancels its
  transition, and for about a second after switching the mode the images that were on screen stay mounted
  (`lingeringFiles` in `VirtualizedRenderer.tsx`) so they glide out instead of vanishing.
- Tooltips of buttons in `#toolbar` and `#top-bar` are always placed underneath the whole bar
  (`widgets/popovers/Tooltip.tsx`), so they never cover neighbouring buttons. Keep tooltip texts short.
- The arrow next to the gear hides the whole bar above the gallery (`UiStore.isSearchBarVisible`); it stays
  visible while one image is open, because the back button is in it. While it is hidden, the top bar
  takes over the side panel button (left) and Collage, Shuffle, Sort and View (right, before the arrow). Shuffle (Alt+R) and switching two
  collage images (Alt+S) are in `hotkeyMap`, so they show up under Settings, Shortcuts.
  Shortcuts are matched on `event.which`: a synthetic key event in a test needs `keyCode`.
- **"Locations" are called "Sources" in everything the user reads** (panel title, dialogs, messages, help).
  The code keeps `location` in names, ids and the database (`locations` table, `locationId`): do not rename those.
- The screensaver settings pick tags and collections with the same type-to-search `TagSelector` as the inspector
  (it takes `extraSelection` and `renderExtraOptions` for the collections; `screensaverCollectionIds`).
- The screensaver shows the tags picked in its settings (`UiStore.screensaverTagIds`); none picked means
  the home tag.
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

- **Never use `instanceof HTMLElement` / `Element` on an event target in shared widgets.** The settings, help
  and about windows are separate windows drawn by the main window's React: their elements are made by the
  other window and fail that check. It made the screensaver's tag picker close before a click could land.
  Check `typeof target.matches === 'function'` instead.
- **Large gallery cells** (`image/SharpImages.ts`, rule in `common/sharp-size.ts`, tested): when a cell needs
  more device pixels than the thumbnail has (600 at most; a square grid cell needs them on the short side,
  and the zoom of the app counts), the thumbnail is shown first and replaced by the image drawn at exactly
  that size in the image worker of the screensaver. Do not go back to putting the original file in the
  `<img>`: at the largest size that decoded about 86 megapixels per screen while scrolling.
- Collage mode: a click selects for switching, at most two images (`LayoutSwitcher.tsx`); the selection
  ring is a rule of its own in `content.scss`, because the collage gives every cell a background that
  covers the usual one.

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
- The screensaver decodes the image files themselves; TIFF, PSD, EXR and Krita images are shown from their
  thumbnail (less sharp), and are left out when they have none.
- The crash "File bug report" link (`githubUrl` in `common/config.ts`), the update dialog's release page link
  (`src/main.ts`) and `dev-app-update.yml` still point at the original project.
- Electron 21 no longer receives security updates, and the renderer runs with Node integration and without
  context isolation. Acceptable for local files only; do not load remote content.

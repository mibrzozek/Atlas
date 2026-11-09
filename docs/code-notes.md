# Code notes

The detailed notes that used to be in CLAUDE.md (moved here word for word on 2026-10-28, when
CLAUDE.md was cut to its rules). How each part works, what was measured, and why it is the way it
is. Search this file, or ask the graph (`graphify query "..."`, which indexes this file too).

## Verifying in the real app

The user's Atlas is driven only through the Director (`scripts/dev/atlas.js`), never the debugging port.
Checks that need more than its commands run in the hidden copy (`node scripts/dev/hidden.js start`; its
port is printed): evaluate JavaScript in its main window over the Chrome DevTools Protocol from Node
(`node --experimental-websocket`, `Runtime.evaluate` with `awaitPromise`), and clear every timer of the
probe so it exits as soon as it has its answer. The MobX
root store is reachable by walking the React fiber from the element that has a `__reactContainer$…` key until
`memoizedProps.value.fileStore` exists. Node integration is on in the renderer, so `require('fs')` works there.
This is how scrolling, layout, cropping, sort order and the read-only guards were checked.

Ways to check things, from least to most intrusive:

1. **Pure logic in `common/` with a jest test.** Layout maths, rules, file helpers. Fastest, and it stays.
2. **Hidden harness** (`show: false` window, own `userData` inside the repo): decode speed, memory, workers. Load
   the built worker bundle from `build/` to test the real code. Nothing is painted, so no animations and no
   `requestAnimationFrame`: a probe that waits for a frame hangs forever.
3. **Hidden, off-screen copy of the whole app** (`scripts/dev/hidden.js`, entry `hidden-entry.js`): hooks
   `Module._load` so `electron`'s `BrowserWindow` is a subclass forcing `show: false` and
   `webPreferences.offscreen: true`, then requires `build/main.bundle.js`; its profile is
   `.dev-hidden-profile/`, with `TEMP`/`TMP` inside it. It paints, so `Page.captureScreenshot` and CSS transitions
   work. Generate numbered sample images into the profile, add them as a location through the stores, tag them.
   It has no real screen: window bounds, focus and the taskbar are fake there.
   Windows the page opens itself (settings, screensaver) are not made through that class: also wrap
   `webContents.setWindowOpenHandler` to add `show: false` and `offscreen: true` to what the app's handler
   returns, and no-op `show`/`showInactive`/`center` on `did-create-window`. Each such window is its own
   DevTools target, so real clicks can be sent to it with `Input.dispatchMouseEvent`.
   Frame times there do not show image decoding (it is off the main thread): measure megapixels decoded
   per screen and the time until images can be painted instead.
4. **Transparent real windows** (`opacity: 0`, `skipTaskbar`) for real window geometry on the real monitors.
5. **The real app on the real screen** (ask first): through the Director, and a picture of the monitors
   with PowerShell (`System.Drawing` `CopyFromScreen`). Delete the pictures afterwards: they show the
   user's screen. What the Director cannot do there, the user does by hand.

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
    with fewer, monitors show the same. "Show one large image per monitor" in the settings
    (`UiStore.isScreensaverSingleImage`) forces this mode with one image, however many there are.
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
  them as working saved searches. `SearchStore` skips those rows. A collection does its own work
  (`entities/Collection.ts`: `collection.tags`, `.has(tag)`, `.add(tag)`, `.remove(tag)`, `.rename()`,
  `.view()`, `.isViewed`); the store only keeps the list, its order, and the saving. `tags`, `isViewed` and
  the store's `collectionsOf` are deliberately not MobX actions: inside an action nothing is tracked, and
  the panels stopped updating.
  Both trees of tags (side panel and editing page) drag and drop through `TagsPanel/useTagItemDnD.ts`.
  Per-tag image counts come from the database index (`countFilesByTag`), because the loaded files are only
  the ones shown, which at start-up is the home gallery.
  The tag list in the editing page is a tree like the side panel used to be (`TagManagerTree.tsx`): click,
  ctrl-click and shift-click select, dragging reorders and nests, double click or F2 renames, and the bar
  above it acts on the selection. It has a drag holder of its own (`TagDnDProvider`); the one in `Main.tsx`
  does not reach a dialog. The tree widget does not watch the selection: whoever renders it has to read it.
- All outliner panels are exactly as tall as their content (`fitContent` on `MultiSplitPane`); the outliner
  scrolls as a whole. The image counters live at the foot of the Locations panel (`FolderCounts.tsx`): all
  images and tagged images with a percentage, for the open folder (counted in the database with
  `countFilesInFolders`) or the whole library. "Tagged" is the search `tags notContains []`
  (`taggedCriteria()` / `isTaggedCriteria` in `SearchCriteria.ts`). Counts from the database go through
  `hooks/useDatabaseCount.ts`, which counts again when `FileStore.numSaves` goes up: that is when a tag
  change is really in the database. Do not go back to counting on a timer.
- Collage mode (`FileStore.isCollageMode`, toolbar button): the gallery shows the order made by hand for the
  current view instead of the sort order. The order is a list of image ids in `localStorage` under
  `Atlas_CollageOrder:<view>`, one per tag/folder/search, for views of up to 5,000 images; logic in
  `common/collage.ts` (tested), drag and drop in `ContentView/collageDnD.ts`. Not in the database, so not
  in backups. Outside collage mode, dragging an image still starts an export drag out of the window.
  The gallery cells have `contain: strict`, which clips anything drawn outside them: the marker for where a
  dragged image lands is an element of its own, appended to the gallery and positioned by measuring.
  While collage mode is on the gallery uses the grid layout whatever the view is set to, with every image
  shown whole inside a slot of the same size: a move or a switch then changes nothing but the images
  involved (measured: 36 other images did not move a pixel, scroll position unchanged). A reorder
  deliberately leaves `fileListLastModified` alone: setting it lays the gallery out again, which scrolls
  the first image back to the top.
  The cells are drawn in a fixed DOM order (sorted by id) because React moving an element cancels its
  transition, and for about a second after switching the mode the images that were on screen stay mounted
  (`lingeringFiles` in `VirtualizedRenderer.tsx`) so they glide out instead of vanishing.
- **Test drags and hovers with the real input pipeline, not with events made in the page.** Events dispatched
  from JavaScript hit the element you name and carry whatever you put in them, so they passed while the real
  thing failed three times: a tooltip never opened because the pointer is over the icon inside a button, a
  drop was refused because its `dropEffect` ('copy') was not among what the drag allowed ('linkMove'), and an
  open tooltip swallowed clicks on the buttons underneath it. Over the DevTools protocol:
  `Input.dispatchMouseEvent` for moves and clicks, and for a drag `Input.setInterceptDrags`, mouse down and
  a few moves, then replay the `Input.dragIntercepted` data with `Input.dispatchDragEvent`
  (dragEnter, dragOver, drop). A capture-phase listener that logs `mousedown`/`click` targets shows at once
  what really got the click.
- **Everything the app tells the user is in the status footer** at the bottom left
  (`containers/StatusFooter.tsx`, `status-footer.scss`): the messages of `AppToaster` as small cards
  (with their action and a ×; one with `timeout: 0` is work going on and gets the running line), and under
  them the progress of work in the background. At the foot of the side panel and as wide as it; with the
  side panel hidden, on its own. Nothing pops up bottom right any more (the user asked for that): show a
  message with `AppToaster.show`, never a corner of its own.
- Tooltips: the element with `data-tooltip` is found with `closest`, an open tooltip never takes clicks, and
  for something inside an open `<dialog>` the tooltip element is moved into that dialog (a modal dialog is
  drawn over everything else, whatever the z-index).
- Tag colors can be a color of the theme, stored as `var(--accent-color)` and the like
  (`components/TagColorPicker.tsx`): the tag then changes with the theme. Anything that works out a contrast
  from a tag color must expect that (`widgets/tag.tsx` does). Kept colors are in `localStorage` (`tag-colors`).
- Collections in the editing page are small chips (name and a plus); a click opens one, a drag moves it. Both
  lists of collections drag and drop through `CollectionsPanel/useCollectionDnD.ts`. A new one goes on top.
- Collage: while an image is dragged the browser sends no wheel events, so the gallery scrolls by itself when
  the image is held within 90 px of its top or bottom edge (`collageDnD.ts`).
- Tooltips of buttons in `#toolbar` and `#top-bar` are always placed underneath the whole bar
  (`widgets/popovers/Tooltip.tsx`), so they never cover neighbouring buttons. Keep tooltip texts short.
- The arrow next to the gear hides the whole bar above the gallery (`UiStore.isSearchBarVisible`); it stays
  visible while one image is open, because the back button is in it. The side panel button (the
  hamburger, key 1) is always the first button of the top bar, never in the bar above the gallery. While
  that bar is hidden, the top bar takes over Collage, Shuffle, Sort and View (right, before the arrow).
  Create Folders and Tags and Collections open at the gallery's top left (`galleryCorner`, the
  `placeAt` of `Dialog`), as the tag inspector does (`galleryRect`). Shuffle (Alt+R) and switching two
  collage images (Alt+S) are in `hotkeyMap`, so they show up under Settings, Shortcuts.
  Shortcuts are matched on `event.which`: a synthetic key event in a test needs `keyCode`.
- **"Locations" are called "Sources" in everything the user reads** (panel title, dialogs, messages, help).
  The code keeps `location` in names, ids and the database (`locations` table, `locationId`): do not rename those.
- The tag inspector (right click on a tag, Inspect...; `containers/TagInspector.tsx`, rules in
  `common/tag-inspection.ts`, tested) is a window of its own: counts, folders, and every image with a small
  picture; hovering one opens a frameless preview window beside it, and the rows above and below switch it.
  A right click on a folder or image reveals it in Explorer or copies the path; each row has a copy button.
  It only reads. The page places the inspector at the top left of the gallery (`inspectorPlace`); `main.ts`
  checks that place against the real screens (`keepOnScreen`) and places the preview itself
  (`previewPlace` of `visibleFrame`): on Windows a framed window's bounds include an undrawn 7 px border
  left, right and below, so a preview of the inspector's outer size looked taller than it. Hidden copies of
  the app are told of a 0 by 0 screen (`screen.availWidth`): fake one in a test.
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
- **Never put a script inside a shell command** (no heredocs, no `node -e "..."`, no `sed -i` for edits). The
  Bash tool mangles backticks, `$`, quotes and backslashes in them, and it has cost many failed round trips.
  Edit source with the Edit tool. When a helper script is really needed, write it to a `tmp-*.js` file with
  the Write tool, run it with a plain `node tmp-x.js`, and delete it. `sed -i` also strips the CR of CRLF
  files. Build Windows paths with `path.sep`. Several source files use CRLF line endings; preserve them.

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

- **The screensaver starts whenever Atlas is open** (visible, not minimized) and the computer has been idle,
  not only when Atlas is the focused window: that rule meant it hardly ever started. "Only while Atlas is the
  window in front" is a setting, off by default. It never starts on the lock screen. Because the keyboard
  can then belong to another application, the running screensaver also asks the system every half second
  whether anything was used (`SCREENSAVER_WAKE_IDLE_SECONDS`), with a timer of a screensaver window.
- Ctrl + mouse wheel over the gallery makes the thumbnails larger or smaller (`UiStore.growThumbnails`, 40 px
  a notch, between the ends of the View menu slider) instead of zooming the window. The listener is a native
  non-passive one in `ContentView/index.tsx`: a React `onWheel` cannot stop the browser's zoom. Touchpad
  amounts add up to a notch; what is left over is dropped when the wheel turns the other way. Not in the viewer.
- **Workspaces** (plan and status in `docs/workspaces-roadmap.md`): tabs in the top bar (Library + one per
  workspace), a Workspaces panel, and an endless surface drawn over the Library, which stays mounted
  underneath. Maths in `common/workspace.ts` (tested); `entities/Workspace.ts` (items, groups, selection,
  undo; the lock is enforced there); `stores/WorkspaceStore.ts`; stored in a database of its own,
  `Atlas_Workspaces` (`backend/workspace-db.ts`), so the library database stays at version 8. Not in backups.
  Images are read as plain rows (`fetchFilesByID`), never as `ClientFile`s. Any change to what the Library
  shows brings the Library tab back (a reaction in the `UiStore` constructor).
  Speed rules, measured at 2,000 to 12,000 images (`containers/Workspace/WorkspaceSurface.ts`):
  pan and zoom only set one transform on the world element, outside React; images under 48 px on screen
  are drawn on a canvas from 48 px tiles (`TileImages`), not as elements; zoomed far out one overview
  picture (up to 4096 px) is drawn instead of every tile, which took a 12,000-image workspace from never
  finishing to 16 s; the stacking order is the page order, not `z-index` (that made every image a layer);
  which images get an element changes only at half-octave steps of the zoom; dragged images are moved in
  the page and stored once on release. Images get the pixels they cover once the camera stops (the
  `SharpImages` workers), and the file itself from its full size on. Tiles are prepared in the background
  per workspace (`WorkspaceImages`, kept for the last 3 opened); from 2,000 images on, + asks first and
  does not open the workspace. Progress shows in the status footer (`BackgroundProgress`, shared with
  the start-up scan). Pointer capture makes the surface the target of clicks and double clicks:
  remember the pressed image, or use `elementFromPoint`.
  Everything on a workspace is an object (`WorkspaceItem`: an image, whose id is its file id, or a text)
  with its own `z`, its layer. The name of a batch is a text object; rows stored before that have a
  `groups` list, which `workspaceFromRow` turns into texts. Texts are measured in the page
  (`measureText.ts`, same font and weight as `.workspace-text`) so their frame fits the letters; the store
  takes the measuring as a parameter so tests can pass their own. Texts are always elements, never tiles.
  The layers panel (`LayersPanel.tsx`, right of the surface, folds into the Layers button) draws only the
  rows in sight; dragging rows calls `moveLayers`, which numbers every `z` anew. Every change is stored
  0.4 s after the last one (`saveSoon`; `saveAll` from `RootStore.close` on unload): a save writes the
  whole row, 56 ms of blocked window at 30,000 objects.
  A box, a drag or a sizing is held by where it was pressed on the workspace (`Press.startInWorld`) and
  brought up to date whenever the camera moves too (`follow`): the wheel or a zoom during a drag, or
  scrolling by itself at an edge (`scrollAtEdge`). What is dragged is also looked for at its moved place
  when deciding what gets an element, and its elements are found again when they change mid-drag.
  Tiles are kept in the `tiles` table of `Atlas_Workspaces` (version 2 of that database, not of the
  library's) with each image's average colour, checked against the file's modified date; far out an
  image without its tile is drawn in that colour. Save as picture (`SavePictureDialog.tsx`,
  `workspacePicture.ts`) asks for a name (`fileNameOf`) and a format, then a folder, and writes with
  `writeNewFile` (`common/export.ts`), which never overwrites. Printing was taken out for now.
  Several selected get a frame (`SelectionFrame`) whose handle sizes them together (`scaleItems`, the
  'scale' gesture, around the frame's top left, snapping its outer edges); Alt + wheel does the same
  around the middle (`scaleByWheel`). Both are sessions like Arrange's (`scaleSelection` with a `from`
  snapshot, `sessionFrom` in the entity): one undo step, no drift. The frame's handle is checked before
  "pressed on nothing" in `gestureFor`, as the frame is no object.
  Cropping: an image can have a `crop` (fractions of its photo, `common/crop.ts`, tested); without one it
  shows the middle (`centeredCrop`), as it always has. Everything that draws an image goes through
  `cropOf`: the element (the whole photo placed in a clipping frame, `photoInFrame`), the tiles and the
  overview (`cropSource`), and the saved picture. The crop session is `ClientWorkspace.cropping` (photo
  and frame on the workspace), drawn by `CropOverlay` in a layer of its own over the others, which are
  blurred (`data-cropping`). The surface sees presses before React does: the crop tools are recognised in
  `gestureFor`, a React `stopPropagation` would come too late.
  The crop's tools are in a layer of their own in pixels of the screen, placed under the frame by the
  surface in every frame (`placeCropTools`): scaled by React's settled zoom they changed size while the
  camera glided. Handles and lines take their size from `--zoom`, set in every frame; the lines are
  shadows and gradients, as a border under a pixel is rounded up to one before the camera scales it.
  Groups of layers: an object's `groupId` and the workspace's `layerGroups` (`LayerGroup`: name, locked);
  the membership is on the objects so that undo covers it, and a group without members is neither shown
  nor stored (`groupsInUse`). Selection goes through `withGroupMates`: a locked group comes whole. The
  layers panel lists `layerRows` (a group row, its layers under it when opened) and maps a drop among rows
  back to a place among layers. The naming dialog is `GroupLayersDialog` (`UiStore.isNamingLayerGroup`).
  Slow scrolling (`UiStore.isWorkspaceSlowScroll`, Ctrl + wheel click, `onToggleSlowScroll`): the wheel pans
  and zooms a tenth as far (`SLOW_WHEEL_SPEED`); Alt + wheel sizing keeps its pace. Not stored.
  A notch of a mouse wheel glides (`glideWheel`): it is added to what is still to go, and the camera eases
  through it in about 0.2 s, by the time between frames; zoom glides around the pointer. Touchpad steps
  (under `NOTCH_DELTA`) move at once. A drag or another glide takes over (`stopWheelGlide`).
  The grid is lines or dots (`UiStore.workspaceGridStyle`, the Grid menu; G shows or hides it); dots
  use `gridLevels` with a wider `MIN_DOT_SPACING`, each level drawn as one path.
  A new workspace is laid out as the Library shows it (`UiStore.galleryLayout`, mirroring
  `wasm/masonry/src/layout.rs` in whole pixels; grid with square thumbnails cuts to 1:1) and starts with
  its batch selected. Arrange (a menu that stays open) lays a selection out in rows, columns or a grid,
  cut 1:1 or 4:5 or whole, with a spacing; rows and columns can "Fill to the edges" (`fill`,
  `spreadToEdges`): sizes kept, the spaces in each row or column widened so it reaches both edges of the
  block, as the longest does (a row of one image stays put); images remember their photo's shape (`imageAspect`) so a cut
  can be undone. Dragging snaps edges and middles, and even gaps in the same row or column
  (`snapMove`, guides drawn over everything); Alt drags freely. Swap trades two places. A background is a
  sheet (default white A4) drawn in its own layer under the tiles canvas, so small images stay visible on
  it; a drag on an unselected sheet draws a selection box, a click selects it, and a selected sheet is
  dragged on its own: what lies on it stays where it is (the user asked for that). The picture
  (`workspacePicture.ts`) is the selected sheet, the selection or everything at the full resolution of
  its photos, capped at 8,192 px (127 MP took over half a minute).
  An Arrange session lays out from a snapshot of how things were (sizes never drift, one undo step, stored
  once it rests), one step per frame. **Never read an observable array item by item** (`for...of`, `[i]`,
  spread): in this development build every read is checked (`observableRequiresReaction`), which cost 65 ms
  per slider step at 2,000 images. Take `.slice()` once and loop over the copy.
  Things of the Library are added by dropping them (`libraryDrop.ts` reads the drag, `WorkspaceStore.addBatch`
  searches the database like the gallery and places them): a tag, a collection, a source or a folder of
  it (subfolders drag as `DnDFolderType`, their path), or gallery images, which leave as a native file
  drag and are matched by path. On the surface the batch lands where it was dropped; on a tab or a row of
  the Workspaces panel next to what is there, and held there 0.7 s that workspace opens
  (`useWorkspaceDrop.ts`, shared by both, which also reorders them). Ctrl+C / Ctrl+V copy objects within
  and between workspaces (`pasteItems`); an image is on a workspace once, so there is no duplicate key.
  A text without a colour of its own is drawn dark on a light sheet and light on a dark one (`textInk`,
  also in a saved picture). The workspace keys are in `hotkeyMap` (Settings, Shortcuts), with Ctrl+0 for 100%
  and Ctrl+Shift+Z for redo; the page takes Ctrl+0 before the menu's window zoom.
  The tabs are as flat as the toolbar buttons; the open one has an accent line on the bar's lower edge.
  A tab is not the workspace: × (or a wheel click) closes the tab only (`UiStore.closeWorkspaceTab`,
  stored as `closedWorkspaceTabIds`, so new workspaces have a tab); the workspace stays in the Workspaces
  panel, and opening it there brings the tab back. Deleting is only in the right-click menu of a tab or
  row (`useWorkspaceMenu`), and asks first (`UiStore.workspaceToDelete`). Duplicate is in the same menu
  (`WorkspaceStore.duplicate`): a copy through JSON (nothing shared), named "… copy", right after the
  original, opened; its tiles are shared, as they are kept per image. The top bar has a
  `ContextMenuLayer` of its own: the one in `Main` does not reach it. Like a browser's, the tabs shrink
  from 160 px to 44 px (container queries hide the × of other tabs, then the names), then scroll with the
  wheel; nothing else in the top bar shrinks.
  The settings window's `[role='tablist']` / `[role='tab']` rules are global: anything with those roles
  has to undo them (`.workspace-tabs` does).
  **Video mode** (the Video button; plan and status in `docs/workspace-video-plan.md`): a workspace's
  `video` (`common/video.ts`, tested) is lanes on one timeline: the camera (stops in a row: a frame, how
  the camera arrives, `Arrival`, and what it does there, `Stay`), the layout (optional arrangements in a
  row; empty means the workspace as it is), motions (behaviours of chosen objects over a stretch of time,
  `common/video-motion.ts`: entrances hide an object before, exits after) and music (one song, its beats
  found by `common/beats.ts`, tested on made-up songs only). `stateAt` says what a frame shows at any
  time; the preview (`VideoPreview`, with the music: `playMusic`) and the saved MP4 (`workspaceVideo.ts`:
  WebCodecs H.264 baseline `avc1.42002a` and AAC, mp4-muxer) both draw it with `drawFrame`, through
  `WorkspacePainter` (`paintWorkspace.ts`, shared with Save as picture). Nothing is recorded off the
  screen: every frame is drawn at its exact time, from images decoded once (`VideoImages`). Songs are
  read, never written (`videoMusic.ts`). `color-mix()` is newer than this Chromium: do not use it.
  **Shots**: every camera stop is a shot, its frame a rectangle on the workspace (`VideoShots`, placed
  in pixels of the screen by the surface in every frame, `placeShots`, so its lines stay thin): dotted
  with a "Shot N" label (the dots are drawn as gradients: a dotted border cannot be spaced), the shot
  before the selected one (`shotBefore`) fuller. The selected one is in the accent colour; around it a
  veil (`.workspace-shot-veil`, `backdrop-filter`) blurs and darkens the workspace, and the surface cuts
  the selected shot out of the veil and out of every other shot (`holeIn`, an evenodd `clip-path`), so
  no other line shows inside it while the other shots stay sharp over the veil. Every element there
  has a key: React reused the "Video" frame's element for the veil, with the place the surface had set
  on it. Selecting a camera
  block glides the view to its shot (`lookAtSelectedBlock`, fitted above the panel) and the shot is
  locked: panning and zooming never change it. "Edit shot" in the Selected tab (`editShot`; it is the
  `editingShotId` of the entity, so selecting anything else ends it) lets it be dragged and sized by its
  corner, lining up with the shot before it only (`snapMove`, `snapSize`, `shotOthers`; the user asked
  for that over every photo near; Alt: not), stored once let go (`setShotFrame`, one undo step); "Lock shot", Enter or Escape lock it.
  + adds a shot beside the selected (or last) one, as large (`nextShotFrame`), selected and unlocked; the
  first is the video's frame, which shows dotted ("Video") while there are no stops. A motion block
  glides the view to what it moves; other blocks select no shot. The lock of the workspace is for its
  objects only: shots can be edited, and the video undone, while it is locked.
  A selected shot shows over the objects where the layout on as it begins has them, as the preview
  (`) films them: they are put there like for a selected layout (one undo step); on a locked workspace
  they are only drawn there (`shownPoses`, `shownItems`), so that neither the lock nor undo changes. The
  outline once sat over the second layout's arrangement while the preview showed the first.
  The selected layout takes over every change of the workspace (`followInLayout`), but only once its
  arrangement was put on the workspace (`followedLayoutId`: not on a locked workspace, and not after an
  undo moved the objects away from it, which once overwrote a layout with another arrangement). A change
  of the video's settings never touches a layout. Undo carries the video only for a change to it
  (`remember(…, 'whole')`, which puts all of the video back as it was, settings made since included) or,
  for a change of the objects while a layout takes them over, the layouts; otherwise the video is left
  as it is. Settings and drags (not undo steps) go through `changeVideo` and end the redo trail.
  Leaving video mode clears the selected block of every workspace. Enter and Escape lock the shot being
  edited only while the shots are on screen (no preview, crop, dialog or focused button). The workspace
  knows the panel's real height (`videoPanelHeight`, `setVideoInset`), which only changes where the view
  glides to, never the camera itself. The playhead's time is a component of its own (`PlayTime`): read by
  the panel or the preview it drew them anew in every frame. The preview decodes again only when the sizes it needs change (`neededWidths`, in
  steps), from the file whenever the thumbnail is too small for that (`thumbnailWidthOf`: a photo filling
  a 9:16 frame needs well over its 600 px), and lets go of the old images once the new ones are drawn;
  it reads the video at every frame. Files are decoded in the image workers (`sharpImages.drawBitmap`):
  decoded in the window they made the first play choppy. While a pass decodes, the playhead and the
  music wait (`isPreparing`); an outdated pass stops (`prepare`'s `isCancelled`, also Stop when saving);
  each image is drawn once before playing (`warmUpIn`). Saving goes through `WorkspaceStore.saveVideo`, one at a time
  (`isSavingVideo`). The panel (`VideoPanel`, `VideoTimeline`, `VideoSettings`) is shown only once there is
  a video: what depends on its room measures after that (`surface.resize()`). The timeline shows a minute
  at first; the wheel over the timeline moves it left and right, Ctrl + wheel zooms it around the
  pointer. Every drag on it is one
  pointer capture on the track (`begin`), never HTML drag and drop (which took over the drags of edges);
  dragged edges snap to beats, other edges and the playhead (`snapTime`; Alt: not). The video ends at
  the end marker (a red triangle on the ruler, `.workspace-video-end`; what follows is dimmed): `video.end`,
  undefined while it follows the end of the camera (`naturalEnd`), set by dragging it or in the End field
  of Export (`setVideoEnd`; the ↻ button puts it back). Adding a camera stop puts it back on the end of
  the camera, so the new stop is in the video (undone with it). `videoLength` is that end, so playing, the time
  and the saved MP4 (`frameCount`) all stop there. Loop (`player.isLooping`, not stored) starts playing
  over at it; `player.loops` counts up so the music starts over too. WebCodecs exists only
  on a secure page; the app's is one. The settings of every tab are planned rows (`.workspace-video-row`):
  label beside control, one width per kind of control in rem, the first labels lined up, the buttons
  together at the right end (`.workspace-video-actions`); the tab is at least two rows tall and grows (the
  panel with it, through a `ResizeObserver`) rather than scroll. Checked at 100, 125 and 150% zoom.
  Every tab must be exactly as tall, or the panel's content jumps when switching: buttons in a row are
  held to the control height (the app's are at least 2rem), and the "Nothing selected" text is one line.
  The workspace is told how much the panel covers only once, as it opens (`onCover`): telling it again on
  every measure re-fitted the frame and moved the camera on every tab switch. Check at a device scale of
  1.3 too (`--force-device-scale-factor=1.3`, the user's screen): fractional pixels showed it there.
  The panel has its tabs and playing on top, then the tab's settings,
  then the timeline; it opens (and grows for a tab) as tall as its content, measured with its height let
  go before anything is drawn. The ` key shows the video at the playhead over the whole window and back
  (`VideoPlayer.toggleFullscreen`; a window-wide key listener while in video mode): that preview is drawn
  in `#layout-container` through a portal, as inside the workspace a fixed element is held to its box.
  It takes the focus; under the video (never over it: the canvas fits the stage the bar leaves) is the
  panel's own `Timeline` with `isPlayback` (half its height, `PLAYBACK_SIZES`; 86 px in all), with the
  deck on its left (`.workspace-video-deck`, 11rem whatever is in it: play and time at the top left,
  rows of options such as Loop under them; laid out for more in docs/workspace-video-plan.md, "The
  full-window player"): the whole video in view, no + buttons, nothing selected, and
  every press scrubs (playing goes on after the scrub). After 2 s of a resting mouse while playing the
  pointer and the close button go; the timeline stays. Space is stopped on its
  way up too (`keyup`), or a focused button would toggle the playing straight back. The panel cannot be
  dragged lower than its content (`leastHeight`), the wheel acts only over the timeline, and the
  timeline's scroll bar is always there (one that came with zooming made it taller and cut the panel).
  Anything laid over the surface with controls of its own needs `data-surface-overlay`: the surface
  listens before React does and would capture the pointer away from its buttons.
- The viewer (one image open) keeps the search bar in its toolbar; searching from there goes back to the
  gallery with the results.
- Dragging in the lists of the side panel (`Outliner/TreeItemDnD.ts`): one shared line that glides between
  the rows shows "above/below", a steady highlight shows "inside". A `dragleave` to a child of the same row
  is not leaving it (clearing the mark there was the flicker). The line is appended inside the element that
  carries the theme class: CSS variables of the theme do not exist on `body`.
- The README screenshots (`resources/images/readme/`) show generated pictures, never the user's photographs:
  the repository is public. Regenerate them the same way, in a hidden copy with its own profile.

## Open review findings (2026-10-23)

A review of all the video and Director work, by reading the code (not measured). Not fixed yet:

- **High: motions get slow with many photos.** `motionAt` (`common/video-motion.ts`) looks every object up in
  every motion's `targets` with `indexOf` on every frame: objects × objects × motions. Waves target every
  photo, one per swell. Fix: a map from id to place, made once per motion (a `WeakMap` on the motion).
- **Medium: a long stagger cuts motions short.** Each object's part is `end - (start + place * stagger)`, which
  can reach 0: with 40 photos in a drop-in, from photo 17 on they just appear; "Pop out" on 30 photos leaves most
  on screen after the block. Fix: each object its own fixed duration from its staggered start, or a stretched
  length, and a capped stagger; add a test.
- **Medium: the Director's hold runs out during long saves** (2 minutes from the start of a command): the window
  is throttled again and the screensaver may start. Fix: renew the hold until the page answers, and have saving
  a video hold off the screensaver in the app too.
- **Medium: a Ctrl+R before the Director's first command is not noticed**, so a command sent during that reload
  waits 30 minutes. Fix: `watch` the window in the READY handler.
- **Medium: features only the Director calls**, which nothing reaches in a shipped build: `addTitle`,
  `fitVideoFrame`, `wavesToTheMusic`, arranging with `even`, the sample of `createOf`, `holdScreensaver`.
  Proposed buttons: "Add title", "Fit" beside Format, "Waves on the swells" beside Cut to the beat, "No single
  photo in a row" in Arrange, "A random 200 of them" when a workspace would be too large. Waiting for the user.
- Low: the Director's older commands (`arrange`, `shuffle`, `waves`) let NaN through (`end` and the edits
  check with `numberOf` since 2026-10-29); swells can be 1.5 s
  apart although the comment says 3; the "no single photo" search is quadratic; `VideoImages.prepare` without a
  `.catch` leaves the preview waiting for good, and so does a crashed image worker for a save; the Export tab
  shows nothing when a save cannot start; `soundPicture` takes an endless range; Cut to the beat replaces every
  motion, waves and hand-made ones too, without a word; the Director's `ready()` polls for what
  `saveVideo` already waits on.

## Odds and ends from the old CLAUDE.md

- Read-only guards in full: writing metadata (`ExifIO.writeTags`, `ExifIO.writeData`), moving to the trash, and
  moving files between folders by drag and drop (`handleMove` in `LocationsPanel/useFileDnD.ts`), which could
  also replace and permanently delete another file. The folder creator is `containers/FolderCreator.tsx` (the +
  in the top bar); its only write is `createFolders` in `common/folder-create.ts`.
- The Director, where it lives: the server in `src/director/main.ts` (it answers `songs` and checks `music`
  against `audio/` itself, makes `demo/`), the commands in `src/frontend/director/index.ts`, the messages in
  `src/director/channels.ts`. Stop the hidden copy with `hidden.js stop`.
- The buttons the Director uses are the user's too: Shuffle in the Arrange menu (Alt+R, `shuffleSelection`, the
  last arrangement again with another order), Cut to the beat in the Video tab (`cutToTheBeat`, rules in
  `common/auto-edit.ts`, tested; same seed, same edit), and the Size of Export (Phone, the default:
  `outputSize`/`videoBitrate` in `common/video.ts`, at most about 26 MB). Arranging with `even` never leaves a
  row or column of a single photo (`evenGridColumns`, `hasLoneImage`).
- Theme variables to use: `--background-color`, `--border-color`, `--accent-color`, `--text-color-muted`, ...
- Running the app: `yarn start`, or `.\node_modules\electron\dist\electron.exe ./build/main.bundle.js` (for the
  user's Atlas, use `atlas.js start` instead); `yarn oobe --keep` reuses the throwaway profile. `atlas` and
  `oobe` also work from any terminal: two `.cmd` files next to `node.exe` that point at this folder.
- The nine known prettier errors are `typeof X` parenthesising in untouched upstream files.
- The logo in the app (start-up intro, welcome screen) is `src/frontend/components/AtlasLogo.tsx`: the mark
  and "Atlas" in Georgia italic with "of my mind" in small capitals underneath (the user picked it from
  mock-ups of marks, wordmarks and fonts), in the theme's colours
  It keeps its own colours (blue to green mark, yellow to blue name) where all of them stand out from the
  background actually drawn behind it (`keepsOwnColoursOn` in `common/logo-colours.ts`: 3:1, the small line
  4.5:1). Measured on the preset themes: every dark one keeps them, every light one (Gray not included) takes
  the theme's (`atlas-logo.scss`: the strongest text colour, at least 6.5:1 everywhere; the accent colour is as
  little as 2.8:1, so the mark only starts from it). Judged again when light/dark changes; a custom theme
  switched while a logo is on screen is only seen the next time it is drawn. The app icon keeps its colours.
- **The start opens the home gallery as the home button does, fully loaded, with no splash screen.**
  `RootStore.main` loads the images and the tag counts before anything is rendered; the main window is
  shown at opacity 0 (at its real size, so the gallery is laid out for it: `maximize()` would show a hidden
  window anyway) and becomes visible when the page sends `INITIALIZED`, which it does once the gallery has
  decoded the images in view (`galleryDrawn` in `renderer.tsx`, 4 s at most; `REVEAL_LIMIT` in `main.ts`,
  8 s, if the page never says so). `startInHomeGallery` also collapses the outliner's panels.
  The gallery is drawn unseen (`UiStore.startupPhase` 'waiting', `resources/style/startup.scss`); once the
  window shows, `playStartup` plays the intro (`ContentView/StartupIntro.tsx`: the logo, the name fading in,
  both fading out; Settings, Start-up, "Show Atlas Logo splash screen": `isStartupIntroEnabled`), then the
  images fade in from the top left (`--startup-delay` of each cell). All the timing is in `common/startup.ts`
  (tested): the phases, each image's delay, and the stylesheet's times as CSS variables set on #content-view.
  With "reduce motion" asked for by the system the gallery is simply there.
  Smoothness (the user found the logo choppy): the animation begins only once the main process has answered
  INITIALIZED with WINDOW_REVEALED (every time, also after a reload) and two frames are painted; it used to
  begin while the window was still appearing. The images are hidden one by one with `will-change`, so Chromium
  paints them during the logo (traced: about 50 ms of raster just before it, almost none after) instead of in
  one burst at the reveal, and the logo's parts are layers from their first frame. The hidden copy draws off
  screen and shows no frame timing: smoothness on a real screen is judged there. An image whose thumbnail failed
  keeps a spinner marked `data-failed`, which the start does not wait for. The start always opens the home
  gallery, so the old "Restore and query last submitted search query" setting (and the search, scroll position
  and slide mode it stored) is gone. "Themed logo" (`isLogoThemed`) gives the logo the theme's colours always.
  The masonry lays out at its measured size from the first render, and works out what is in view at once:
  it used to draw one image alone first, then lay everything out again 150 ms later. The random order is kept
  while it is shown (`shuffledBySeed`); only Shuffle or choosing Random makes a new one.
- The crash "File bug report" link is `githubUrl` in `common/config.ts`.

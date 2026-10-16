# Workspaces

Status (2026-10-16): built, checked with real input in a hidden copy of the app, committed. What is left
is under **Next steps** at the end.

A workspace is an endless surface on which images and texts are arranged by hand: moved, stacked, laid
over each other, sized, laid out in rows, columns or grids, on sheets of paper, and printed. The rest of
Atlas does not change around it.

## What there is

**Tabs and the panel.** The top bar has a **Library** tab, one tab per workspace and a **+**. The + makes a
workspace of what the Library shows, laid out exactly as the Library shows it (justified rows, columns,
or a grid, cut to squares when the grid shows square thumbnails), with its name (the tag, collection or
folder) written large above it; the new batch starts selected. From 2,000 images on, + asks first and
prepares the workspace in the background while the Library stays in front; a bar at the foot of the side
panel shows how far it got, the tab a spinner. Tabs rename (double click), reorder (drag) and close (×,
asked). The **Workspaces** panel in the side panel lists them. Any change to what the Library shows brings
the Library tab back.

**Moving around.** The wheel pans (Shift sideways); **Ctrl + wheel and touchpad pinch zoom toward the
pointer**, 1/2000 to 32 times. Space + drag, the middle button, or any drag on a locked workspace pans.
**F** fits everything, **1:1** zooms to 100%, both gliding. A double click on an image glides to it, sharp
at full resolution; on a text, opens it for editing.

**Objects.** Images, texts and backgrounds, each a layer of its own.
- A drag on empty space draws a box that selects what it touches (Shift or Ctrl adds). A click brings an
  image to the front, also one that only shows from under another. Selected objects move together and
  land on top. A handle in the corner sizes the one selected (a text's letters grow along).
- **Snapping** while dragging: edges and middles line up with those of nearby objects, gaps even out with
  the gaps between neighbours in the same row or column, and a sheet lines up with the images it lies
  under as one block (the middle of an even grid is in a gap). Guides show what lines up; Alt drags freely.
- **Texts**: the **T** button or key adds one, readable at the current zoom. Words, size and colour are
  changed in the layers panel.
- **Backgrounds**: the Background button lays a sheet (white A4 by default) under what is selected, or
  in the middle, and the camera glides to show all of it. Colour and paper format are changed in the
  layers panel. A sheet is always drawn under the images and stays the bottom layer; a drag on a sheet
  that is not selected draws a selection box, a click selects it, and a selected sheet moves on its own.
- **Arrange** (two or more selected): rows, columns or a grid; whole images or cut to 1:1 or 4:5; the
  number of rows or columns and the spacing on sliders. The menu stays open; each change shows at once,
  sizes never drift, and the whole session is one undo step.
- **Swap** (two selected) trades their places. **Delete** takes objects off (never the files),
  **Ctrl+Z** undoes, **Ctrl+A** selects all, **Escape** lets go, **L** locks, **G** toggles the grid.
- **Layers panel** on the right (folds into the Layers button): everything from the top layer down, only
  the rows in sight drawn; click selects, drag changes the layer, double click glides to it.

**Print.** The selected sheet, or else the selection, or else everything, composed at the full resolution
of its photos (capped at 8,192 px on the longest side, some 700 dpi on A4) and handed to the system's
print dialog.

## How it stays fast

Measured in the hidden copy with real input. See the Workspaces section of CLAUDE.md for the rules.

- Panning and zooming change one CSS transform on the world elements, outside React; the camera is not
  observable.
- Images smaller than 48 px on screen are drawn on a canvas from 48 px tiles prepared in the background
  per workspace (`WorkspaceImages`, `TileImages`); far out, from one overview picture. A workspace of
  12,000 images was ready in 16 s with the workspace open and frames at 60 per second.
- Only images in view, in whole half-octave steps of the zoom, are elements; their order in the page is
  their stacking order (a `z-index` on every image made the browser re-layer them in every frame).
- Images get the pixels they cover once the camera rests: thumbnail, a version drawn to size by the
  `SharpImages` workers, or the file itself.
- Arrange works from a snapshot, one step per frame, stored once the slider rests: 60 frames per second
  with 2,000 images selected.

## Model and storage

| Where | What |
|---|---|
| `common/workspace.ts`, `tests/workspace.test.ts` | camera, layouts, arranging, snapping, layers, texts, backgrounds, reading stored rows |
| `src/frontend/entities/Workspace.ts` | `ClientWorkspace`: its objects, selection, undo; the lock is enforced here |
| `src/frontend/stores/WorkspaceStore.ts`, `tests/workspace-store.test.ts` | the list, order, saving, preparing images |
| `src/backend/workspace-db.ts` | the `Atlas_Workspaces` IndexedDB (the library database stays at version 8) |
| `containers/Workspace/WorkspaceSurface.ts` | camera, pointer, snapping, grid and tile canvases |
| `containers/Workspace/WorkspaceView.tsx`, `WorkspaceObject.tsx` | what is in view, as elements |
| `containers/Workspace/LayersPanel.tsx`, `WorkspaceTools.tsx`, `WorkspaceTabs.tsx` | panel, bar, tabs |
| `containers/Workspace/WorkspaceImages.ts`, `TileImages.ts` | where images are, tiny versions in the background |
| `containers/Workspace/printWorkspace.ts`, `measureText.ts` | printing; measuring texts |
| `containers/Outliner/WorkspacesPanel.tsx` | the panel in the side panel |

Workspaces are **not in backups** (decided; revisit). Images are read as plain rows, never as
`ClientFile`s, and nothing is ever written to a source folder.

## Next steps

In order of how much they matter:

1. **Try it on the real library and screen.** Nothing here has been seen on the user's GPU and monitors,
   with 20-megapixel photos (preparing a large workspace will take longer than the 16 s measured with
   small test images), or with a real print dialog and printer.
2. **Dropping from the side panel** (step 5 of the plan): drag a tag, collection or source folder onto a
   workspace to add its images as a named batch where it is dropped; drag images from the Library onto a
   workspace tab.
3. **Texts on paper**: a text's default colour is the theme's light text, hard to read on a white sheet
   and printed light. Default to dark on sheets, or pick the colour by what is underneath.
4. **Keys in Settings → Shortcuts**: the workspace keys (T, L, G, F, Alt to drag freely) are hard-coded in
   `WorkspaceView`; put them in `hotkeyMap` so they show and can be changed. Add Ctrl+0 for 100% and
   Ctrl+Shift+Z for redo.
5. **Duplicating and copying** objects (Ctrl+D, Ctrl+C / Ctrl+V within and between workspaces).
6. **Export a sheet to a file** (PNG or JPEG in a folder the user picks, never overwriting): the picture
   `renderForPrint` makes, saved instead of printed.
7. **Snapping while sizing** (to edges and to the sizes of neighbours), and snapping texts by their
   baseline.
8. **Faster reopening of very large workspaces**: keep the tiny tiles in the `Atlas_Workspaces` database
   (one picture of all of them), so 12,000 images do not have to be prepared again after a restart.
9. **Colours far out before tiles arrive**: the average colour of each image instead of grey dots.
10. **The Workspaces panel**: reorder by dragging, rename there, show the image count of each.
11. **Backups**: decide whether workspaces belong in them (needs a second file next to the backup, or a
    database version; the user has not agreed to a schema change).
12. **README**: a section on workspaces with a screenshot of generated pictures (never the user's photos).
13. **Left over from the code review** (2026-10-16; its bugs were fixed before committing):
    - Every committed change writes the whole workspace row; with tens of thousands of objects a drop may
      stall. Debounce all saves like the camera's, and flush when the window closes.
    - An Arrange step still does whole-workspace work (the image ids joined, all objects sorted and
      indexed again); fine at 2,000, unmeasured at 30,000.
    - `UiStore.galleryLayout` reads the gallery's width from the page; pass it in. The Print button finds
      the surface with `querySelector`; give the surface a `print()`.
    - "Fit on first open" relies on the camera being the very `START_CAMERA` object: a large workspace
      prepared in the background and never opened loses it after a restart. Use an explicit flag.
    - Zooming with the wheel while dragging makes the dragged objects drift (offsets are in screen pixels
      from the press).
    - `Math.max(...list)` and the like throw beyond about 100,000 values; use loops.
    - Printing: confirm on the real app that the page is not removed before the printer has it.

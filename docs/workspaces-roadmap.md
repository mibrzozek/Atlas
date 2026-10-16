# Workspaces

Status (2026-10-16): built, checked with real input in a hidden copy of the app, committed. What is left
is under **Next steps** at the end.

A workspace is an endless surface on which images and texts are arranged by hand: moved, stacked, laid
over each other, sized, laid out in rows, columns or grids, on sheets of paper, and saved as a picture.
The rest of Atlas does not change around it. Animating a workspace into a video is planned in
`docs/workspace-video-plan.md`.

## What there is

**Tabs and the panel.** The top bar has a **Library** tab, one tab per workspace and a **+**. The + makes a
workspace of what the Library shows, laid out exactly as the Library shows it (justified rows, columns,
or a grid, cut to squares when the grid shows square thumbnails), with its name (the tag, collection or
folder) written large above it; the new batch starts selected. From 2,000 images on, + asks first and
prepares the workspace in the background while the Library stays in front; a bar at the foot of the side
panel shows how far it got, the tab a spinner. Tabs rename (double click), reorder (drag) and close
(the × on the open one, asked). The **Workspaces** panel in the side panel lists them with their number
of images, and does what the tabs do: click opens, double click renames, drag reorders. Any change to
what the Library shows brings the Library tab back.

**Adding from the Library.** Drag a tag, a collection, a source or one of its folders from the side panel,
or images from the gallery, onto a workspace: on the surface they land as a named batch where they are
dropped; on a tab or a row of the Workspaces panel next to what is there (a message says so, with
Open). Held over a tab for a moment, that workspace opens, to drop in place. They come in the order the
Library sorts them, laid out as the Library shows them, selected; images already there are left out.

**Moving around.** The wheel pans (Shift sideways); **Ctrl + wheel and touchpad pinch zoom toward the
pointer**, 1/2000 to 32 times. Space + drag, the middle button, or any drag on a locked workspace pans.
**F** fits everything, **1:1** zooms to 100%, both gliding. A double click on an image glides to it, sharp
at full resolution; on a text, opens it for editing.

**Objects.** Images, texts and backgrounds, each a layer of its own.
- A drag on empty space draws a box that selects what it touches (Shift or Ctrl adds). A click brings an
  image to the front, also one that only shows from under another. Selected objects move together and
  land on top. A handle in the corner sizes the one selected (a text's letters grow along).
- While a box is drawn or something is dragged or sized, the wheel and a zoom move the view under it:
  the box keeps its start on the workspace, what is dragged stays under the pointer. Held near an edge
  of the view, the view scrolls that way by itself.
- **Snapping** while dragging: edges and middles line up with those of nearby objects, gaps even out with
  the gaps between neighbours in the same row or column, and a sheet lines up with the images it lies
  under as one block (the middle of an even grid is in a gap). While sizing, the right and lower edges
  line up the same way, or the size becomes that of a neighbour. Guides show what lines up; Alt drags
  and sizes freely.
- **Texts**: the **T** button or key adds one, readable at the current zoom. Words, size and colour are
  changed in the layers panel. Without a colour of its own a text is dark on a light sheet and light on
  a dark one, on screen and in a saved picture.
- **Backgrounds**: the Background button lays a sheet (white A4 by default) under what is selected, or
  in the middle, and the camera glides to show all of it. Colour and paper format are changed in the
  layers panel. A sheet is always drawn under the images and stays the bottom layer; a drag on a sheet
  that is not selected draws a selection box, a click selects it, and a selected sheet moves on its own.
- **Arrange** (two or more selected): rows, columns or a grid; whole images or cut to 1:1 or 4:5; the
  number of rows or columns and the spacing on sliders. The menu stays open; each change shows at once,
  sizes never drift, and the whole session is one undo step.
- **Copy and paste** (Ctrl+C, Ctrl+V) within a workspace and between them, pasted in the middle of the
  view; an image is on a workspace once, so images already there are left out.
- **Swap** (two selected, **Alt+S** as in the collage) trades their places. **Delete** takes objects off (never the files),
  **Ctrl+Z** undoes, **Ctrl+Shift+Z** redoes, **Ctrl+A** selects all, **Escape** lets go, **L** locks,
  **G** shows or hides the grid (lines or dots, picked in the Grid menu), **Ctrl+0** zooms to 100%. All but Escape can be changed in Settings, Shortcuts.
- **Layers panel** on the right (folds into the Layers button): everything from the top layer down, only
  the rows in sight drawn; click selects, drag changes the layer, double click glides to it.

**Save as picture.** The selected sheet, or else the selection, or else everything, composed at the full
resolution of its photos (capped at 8,192 px on the longest side, some 700 dpi on A4) and saved as a PNG
or JPEG under a name of your own (the workspace's to begin with) in a folder you pick, the last one
offered first; never over another file, a taken name gets a number. Printing was taken out for now
(2026-10-16); it is in the history (commit d9083410, `printPicture`) to bring back.

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
  with 2,000 images selected (4 to 12 ms a step with 2,000 of 30,000 selected, 46 to 59 ms with all).
- Every change is stored 0.4 s after the last one, and what is waiting when the window closes: a save of
  30,000 objects blocks the window for some 56 ms, which a move of one image used to pay each time (now
  15 ms).
- The tiny versions are kept in the database with the average colour of each image, for all workspaces:
  2,000 images were ready in 0.8 s after a restart instead of 6.9 s, their colours after 0.3 s.

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
| `containers/Workspace/workspacePicture.ts`, `SavePictureDialog.tsx`, `measureText.ts` | the picture and saving it; measuring texts |
| `containers/Outliner/WorkspacesPanel.tsx` | the panel in the side panel |

Workspaces are **not in backups** (decided; revisit). Images are read as plain rows, never as
`ClientFile`s, and nothing is ever written to a source folder.

## Next steps

In order of how much they matter:

1. **Try it on the real library and screen.** Nothing here has been seen on the user's GPU and monitors,
   with 20-megapixel photos (preparing a large workspace will take longer than measured with small test
   images, the first time). Also: dropping a tag of thousands of images (it is not asked about first, as
   + is), and whether the menu's Ctrl+0 stays off the window in the real app (checked only in the hidden
   copy).
2. **Backups**: decide whether workspaces belong in them (needs a second file next to the backup, or a
   database version; the user has not agreed to a schema change).
3. **Kept tiles of images that are gone**: the `tiles` table is never cleaned up. Some 3 KB per image;
   remove the rows of files that left the library, for instance after the start-up scan.
4. **Snapping texts by their baseline**: texts of different sizes line up by their frames, not by where
   their letters stand.

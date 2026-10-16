# Roadmap: workspaces

Status: planned, not started. Agreed on 2026-10-15.

## What it is

- **Tabs.** A row of tabs at the top of the gallery area. The first tab is always **Library**, the gallery
  as it is today. Each workspace is a tab after it. A **+** at the end creates a new workspace.
- **Creating one.** The + takes what is shown from the outliner at that moment (the source folder, tags,
  collections or saved search that are open) and puts those images on a new workspace, one labelled group
  for each thing that was open, then opens its tab. Double click a tab to rename it, drag tabs to reorder,
  × closes (with a confirmation).
- **In the outliner too.** A **Workspaces** panel in the side panel lists them like Collections: a click
  opens one, drag to reorder, sortable by hand or by name.
- **The canvas.** A workspace has no edges.
  - Drag on empty space to pan (middle mouse or Space + drag work anywhere).
  - The wheel pans; Ctrl + wheel zooms toward the cursor, like Ctrl + wheel sizes thumbnails in the gallery.
  - Select, drag, box-select and move images. Removing one takes it off the canvas only: **the file is
    never touched** (Rule 1).
  - Double click opens the image in the usual viewer.
  - "Fit everything" and "Back to 100%" buttons.
- **Adding later.** Drop images from the gallery on a workspace tab (or its row in the panel), or
  "Add to workspace" in the context menu. New images land to the right of what is there.

## How it is built

1. **`common/workspace.ts` with a jest test**: screen ↔ canvas coordinates, zoom around a point, which
   items are in view, where a new group goes (packed rows, the gallery's rule for row heights), the
   bounding box for "Fit everything".
2. **Model**: `entities/Workspace.ts` (`ClientWorkspace`: name, items `{ fileId, x, y, width }`, groups
   with labels, camera `{ x, y, zoom }`; it does its own `add`, `move`, `remove`, `rename`, `view()`, like
   `Collection`) and `stores/WorkspaceStore.ts` (the list, its order, saving). `UiStore.activeWorkspace`:
   when set, `ContentView` shows the canvas instead of the gallery.
3. **Storage**: one JSON file per workspace in the app's data folder, `userData/workspaces/`. No database
   change (schema stays 8), no size limit, debounced writes, never inside a source folder. **Not in
   backups**, by decision; revisit when backups need it.
4. **The canvas** (`containers/Workspace/`): one world layer moved by a single CSS `transform` (panning and
   zooming change only that, nothing is laid out again). Only items in view plus a margin are mounted.
   Thumbnails up close, `SharpImages` when zoomed in past the thumbnail's pixels, plain coloured tiles when
   far out. Pointer events for pan and drag, a native non-passive wheel listener for zoom (see the
   gallery's Ctrl + wheel). The camera is saved when leaving the tab.
5. **Tab bar** in the `#top-bar` style, and the **Workspaces panel** in the outliner with `fitContent`,
   both reordering with the shared drag line of `TreeItemDnD.ts`.
6. Images that are no longer in the library show as an empty placeholder with the file name.

## Steps

Each leaves the app working.

| # | Step | Size |
|---|---|---|
| 1 | `common/workspace.ts` + tests, entity, store, saving and loading the files | ~½ day |
| 2 | Tab bar and Workspaces panel: Library tab, + from what the outliner shows, rename, close, reorder | ~½ day |
| 3 | Canvas: pan, zoom toward the cursor, mount only what is in view, thumbnails | ~1 day |
| 4 | Editing on the canvas: select, move, box-select, remove, open in viewer, add by dropping on a tab | ~1 day |
| 5 | Sharp close-ups, tiles far out, Fit / 100%, measured with 2,000 images | ~½ day |
| 6 | CLAUDE.md section; check with real input in the hidden copy | small |

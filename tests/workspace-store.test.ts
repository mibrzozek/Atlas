import { runInAction } from 'mobx';

import { WorkspaceItem } from '../common/workspace';
import { DataStorage } from '../src/api/data-storage';
import { WorkspaceDatabase } from '../src/backend/workspace-db';
import RootStore from '../src/frontend/stores/RootStore';
import WorkspaceStore, { LARGE_WORKSPACE } from '../src/frontend/stores/WorkspaceStore';

// The messages the store shows (`AppToaster`) time out with the timers of `window`; those must not keep
// the tests from ending
(globalThis as any).window ??= {
  setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms).unref(),
  clearTimeout,
};

let databaseCounter = 0;

/** Letters half as wide as they are high */
const measure = (line: string, fontSize: number) => line.length * fontSize * 0.5;

/** A store on a database of its own, and a second store that reads the same database back */
function setup() {
  const name = `Test_Workspaces_${databaseCounter++}`;
  // A Library laid out in the default way, with no workspace open
  const rootStore = { uiStore: { galleryLayout: undefined, activeWorkspace: undefined } };
  const open = () =>
    new WorkspaceStore(
      {} as DataStorage,
      new WorkspaceDatabase(name),
      rootStore as unknown as RootStore,
      measure,
    );
  const store = open();
  const reopen = async () => {
    const again = open();
    await again.init();
    return again;
  };
  return { store, reopen };
}

/** The words of the texts on a workspace */
const texts = (workspace: { items: readonly WorkspaceItem[] }) =>
  workspace.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));

const images = (...ids: string[]) => ids.map((fileId) => ({ fileId, width: 300, height: 200 }));

/** Lets the writes that are waiting (`saveSoon`) be started and finish */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

describe('WorkspaceStore', () => {
  it('creates a workspace with a batch per source, and stores it', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([
      { label: 'Film', images: images('a', 'b') },
      { label: 'Digital', images: images('c') },
    ]);
    expect(workspace.name).toBe('Workspace');
    expect(texts(workspace)).toEqual(['Film', 'Digital']);
    expect(workspace.fileIds).toEqual(['a', 'b', 'c']);

    const read = (await reopen()).workspaceList[0];
    expect(read.toRow()).toEqual(workspace.toRow());
  });

  it('names new workspaces apart and keeps them in the order of their tabs', async () => {
    const { store, reopen } = setup();
    const first = await store.create([]);
    const second = await store.create([]);
    const third = await store.create([]);
    expect([first.name, second.name, third.name]).toEqual([
      'Workspace',
      'Workspace 2',
      'Workspace 3',
    ]);
    store.move(third, 0);
    await settle();
    const read = await reopen();
    expect(read.workspaceList.map((w) => w.name)).toEqual([
      'Workspace 3',
      'Workspace',
      'Workspace 2',
    ]);
  });

  it('stores every change to what is on it', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    runInAction(() => {
      workspace.moveItems(new Set(['a']), 1000, 0); // apart from the others
      workspace.moveItems(new Set(['b']), 0, 0);
      workspace.resizeItem('c', 600);
      workspace.removeItems(new Set(['b']));
      workspace.rename('Moodboard');
      workspace.toggleLock();
    });
    await settle();
    const read = (await reopen()).workspaceList[0];
    expect(read.name).toBe('Moodboard');
    expect(read.isLocked).toBe(true);
    expect(read.fileIds).toEqual(['a', 'c']);
    expect(read.items[0].x).toBe(workspace.items[0].x);
    expect(read.items[1]).toMatchObject({ width: 600, height: 400 });
  });

  it('puts an image on a workspace only once', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    runInAction(() => workspace.addGroup('Again', images('b', 'c')));
    expect(workspace.fileIds).toEqual(['a', 'b', 'c']);
    runInAction(() => workspace.addGroup('Nothing new', images('a')));
    expect(texts(workspace)).toEqual(['Film', 'Again']);
  });

  it('brings a covered image to the front', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('back', 'front') }]);
    const at = (id: string) => workspace.items.find((i) => i.id === id)!;
    // "front" laid over "back", 50 units off
    const dx = at('back').x + 50 - at('front').x;
    const dy = at('back').y + 50 - at('front').y;
    runInAction(() => workspace.moveItems(new Set(['front']), dx, dy));
    runInAction(() => workspace.bringToFront('back'));
    expect(at('back').z).toBeGreaterThan(at('front').z);
  });

  it('stores the camera a moment after it stopped', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([]);
    workspace.setCamera({ x: 10, y: 20, zoom: 0.5 });
    workspace.setCamera({ x: 30, y: 40, zoom: 0.25 });
    expect((await reopen()).workspaceList[0].camera).toEqual({ x: 0, y: 0, zoom: 1 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await reopen()).workspaceList[0].camera).toEqual({ x: 30, y: 40, zoom: 0.25 });
  });

  it('forgets a closed workspace, also when a store of it was still pending', async () => {
    const { store, reopen } = setup();
    const kept = await store.create([]);
    const closed = await store.create([]);
    closed.setCamera({ x: 1, y: 1, zoom: 1 });
    await store.remove(closed);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const read = await reopen();
    expect(read.workspaceList.map((w) => w.id)).toEqual([kept.id]);
    expect(read.workspaceList[0].index).toBe(0);
  });

  it('moves, sizes, reorders and removes nothing while locked', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const before = workspace.toRow().items;
    runInAction(() => {
      workspace.toggleLock();
      workspace.moveItems(new Set(['a']), 50, 50);
      workspace.resizeItem('a', 999);
      workspace.bringToFront('a');
      workspace.removeItems(new Set(['b']));
      workspace.select('a', false);
    });
    expect(workspace.toRow().items).toEqual(before);
    expect(workspace.selection.size).toBe(0);
  });

  it('undoes changes one at a time, back to where it began', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const start = workspace.toRow().items;
    runInAction(() => {
      workspace.moveItems(new Set(['a']), 10, 0);
      workspace.select('b', false);
      workspace.removeSelected();
    });
    expect(workspace.fileIds).toEqual(['a']);
    runInAction(() => workspace.undo());
    expect(workspace.fileIds).toEqual(['a', 'b']);
    runInAction(() => workspace.undo());
    expect(workspace.toRow().items).toEqual(start);
  });

  it('selects one, adds and takes out with additive clicks, and all', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    runInAction(() => {
      workspace.select('a', false);
      workspace.select('b', true);
    });
    expect([...workspace.selection]).toEqual(['a', 'b']);
    runInAction(() => workspace.select('a', true));
    expect([...workspace.selection]).toEqual(['b']);
    runInAction(() => workspace.select('c', false));
    expect([...workspace.selection]).toEqual(['c']);
    runInAction(() => workspace.selectAll());
    expect(workspace.selection.size).toBe(4); // the three images and the name above them
    runInAction(() => workspace.clearSelection());
    expect(workspace.selection.size).toBe(0);
  });

  it('adds texts of their own, changes them, and keeps them and the order of layers', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    let id = '';
    runInAction(() => {
      id = workspace.addText({ x: 10, y: 10 }, 40)!.id;
    });
    expect([...workspace.selection]).toEqual([id]);
    expect(workspace.selectedText).toMatchObject({ text: 'Text', fontSize: 40 });
    runInAction(() => {
      workspace.changeText(id, { text: 'Moodboard', color: 'var(--accent-color)' });
      // The new text from the top to the bottom layer
      workspace.moveLayers(new Set([id]), 99);
    });
    await settle();
    const read = (await reopen()).workspaceList[0];
    const text = read.items.find((i) => i.id === id)!;
    expect(text).toMatchObject({ kind: 'text', text: 'Moodboard', color: 'var(--accent-color)' });
    expect(text.width).toBe(measure('Moodboard', 40));
    expect(Math.min(...read.items.map((i) => i.z))).toBe(text.z);
    expect(texts(read)).toEqual(['Film', 'Moodboard']);
  });

  it('takes a text off like an image, and puts it back with undo', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    const name = workspace.items.find((i) => i.kind === 'text')!;
    runInAction(() => workspace.removeItems(new Set([name.id])));
    expect(texts(workspace)).toEqual([]);
    runInAction(() => workspace.undo());
    expect(texts(workspace)).toEqual(['Film']);
  });

  it('redoes what was undone, until something else changes', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    runInAction(() => {
      workspace.removeItems(new Set(['b']));
      workspace.removeItems(new Set(['c']));
      workspace.undo();
      workspace.undo();
    });
    expect(workspace.fileIds).toEqual(['a', 'b', 'c']);
    runInAction(() => workspace.redo());
    expect(workspace.fileIds).toEqual(['a', 'c']);
    runInAction(() => {
      workspace.removeItems(new Set(['a']));
      workspace.redo(); // nothing left to redo after a change
    });
    expect(workspace.fileIds).toEqual(['c']);
  });

  it('starts a new workspace with nothing to undo', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    runInAction(() => workspace.undo());
    expect(workspace.fileIds).toEqual(['a', 'b']);
  });

  it('undoes nothing while locked', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    runInAction(() => {
      workspace.removeItems(new Set(['b']));
      workspace.toggleLock();
      workspace.undo();
    });
    expect(workspace.fileIds).toEqual(['a']);
  });

  it('adds to the selection in one step, or replaces it', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    runInAction(() => {
      workspace.selectMany(['a'], false);
      workspace.selectMany(['b', 'c'], true);
    });
    expect([...workspace.selection]).toEqual(['a', 'b', 'c']);
    runInAction(() => workspace.selectMany(['c'], false));
    expect([...workspace.selection]).toEqual(['c']);
  });

  it('puts a dropped batch where it was dropped, selected, and only the images not there yet', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    await store.addBatch(
      workspace,
      { label: 'Dropped', images: images('a', 'b', 'c') },
      { x: 5000, y: 0 },
    );
    expect(workspace.fileIds).toEqual(['a', 'b', 'c']);
    expect(texts(workspace)).toEqual(['Film', 'Dropped']);
    expect([...workspace.selection]).toEqual(['b', 'c']);
    const b = workspace.items.find((i) => i.id === 'b')!;
    expect(b.x).toBe(5000);
  });

  it('asks first before adding a dropped batch of many images, and adds it once confirmed', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    const many = images(...Array.from({ length: LARGE_WORKSPACE }, (_, i) => `many${i}`));
    await store.addBatch(workspace, { label: 'Everything', images: many });
    expect(workspace.fileIds).toEqual(['a']);
    expect(store.largeWorkspaceRequest).toMatchObject({
      imageCount: LARGE_WORKSPACE,
      adding: { label: 'Everything', workspaceName: 'Workspace' },
    });
    runInAction(() => store.confirmLargeWorkspace());
    expect(workspace.fileIds).toHaveLength(LARGE_WORKSPACE + 1);
    expect(store.largeWorkspaceRequest).toBeUndefined();
  });

  it('adds nothing to a locked workspace', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    runInAction(() => workspace.toggleLock());
    await store.addBatch(workspace, { label: 'Dropped', images: images('b') });
    expect(workspace.fileIds).toEqual(['a']);
  });

  it('copies from one workspace to another, selected, and an image only once', async () => {
    const { store } = setup();
    const from = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const to = await store.create([{ label: 'Other', images: images('b') }]);
    runInAction(() => from.selectAll());
    store.copy(from);
    store.paste(to, { x: 0, y: 0 });
    expect(to.fileIds).toEqual(['b', 'a']);
    expect(texts(to)).toEqual(['Other', 'Film']);
    expect(to.selection.size).toBe(2); // "a" and the copy of the name
    runInAction(() => to.undo());
    expect(to.fileIds).toEqual(['b']);
  });

  it('lists the layers from the top down', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    expect(workspace.layers.map((i) => i.id).slice(1)).toEqual(['b', 'a']);
  });
});

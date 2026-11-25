import { observable, runInAction } from 'mobx';

import { DEFAULT_BLOCK_LENGTH, videoLength } from '../common/video';
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
  const rootStore = {
    uiStore: {
      galleryLayout: undefined,
      activeWorkspace: undefined,
      closedWorkspaceTabIds: observable<string>([]),
      openWorkspace: jest.fn(),
    },
  };
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
  return { store, reopen, uiStore: rootStore.uiStore };
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

  it('names a new workspace as chosen, and keeps how its files are named after a restart', async () => {
    const { store, reopen } = setup();
    const naming = { mode: 'pattern' as const, prefix: 'Sample_', digits: 3, suffix: '' };
    const workspace = await store.create([], 'Sample', { fileNaming: naming });
    const plain = await store.create([], 'Sample');
    expect([workspace.name, plain.name]).toEqual(['Sample', 'Sample 2']);
    expect(plain.fileNaming).toBeUndefined();

    const read = await reopen();
    expect(read.workspaceList.map((w) => w.fileNaming)).toEqual([naming, undefined]);
  });

  it('keeps the folder a workspace saves to after a restart', async () => {
    const { store, reopen } = setup();
    const saved = await store.create([], 'Saved', { saveFolder: '/Saves/Sample' });
    await store.create([], 'Asked');
    expect(saved.saveFolder).toBe('/Saves/Sample');

    const read = await reopen();
    expect(read.workspaceList.map((w) => w.saveFolder)).toEqual(['/Saves/Sample', undefined]);
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

  it('extends its photos into a wall of copies after them, one change to undo, stored', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    runInAction(() => {
      workspace.selectMany(['a', 'b', 'c'], false);
      workspace.arrangeSelection('columns', 2, { gap: 8, fill: true, even: true });
      workspace.clearSelection();
    });
    const before = workspace.items.slice();
    const copies = runInAction(() =>
      workspace.extend({ columns: 2, above: 200, below: 200, seed: 3 }),
    );
    expect(copies).toBeGreaterThan(0);
    // Each file once in the list of files; the copies after everything that was there
    expect(workspace.fileIds).toEqual(['a', 'b', 'c']);
    expect(workspace.items.slice(0, before.length)).toEqual(before);
    expect(new Set(workspace.items.map((item) => item.id)).size).toBe(before.length + copies);
    await settle();
    const read = (await reopen()).workspaceList[0];
    expect(read.items).toHaveLength(before.length + copies);
    runInAction(() => workspace.undo());
    expect(workspace.items.slice()).toEqual(before);
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

  it('forgets a deleted workspace, also when a store of it was still pending', async () => {
    const { store, reopen, uiStore } = setup();
    const kept = await store.create([]);
    const closed = await store.create([]);
    closed.setCamera({ x: 1, y: 1, zoom: 1 });
    // Its tab was closed before: that is forgotten too
    runInAction(() => uiStore.closedWorkspaceTabIds.push(closed.id));
    await store.remove(closed);
    expect(uiStore.closedWorkspaceTabIds.slice()).toEqual([]);
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

  it('shuffles what is selected into the places of its last arrangement, one change to undo', async () => {
    const { store } = setup();
    const workspace = await store.create([
      { label: 'Film', images: images('a', 'b', 'c', 'd', 'e', 'f') },
    ]);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const placeOf = (id: string) => {
      const item = workspace.items.slice().find((i) => i.id === id)!;
      return `${Math.round(item.x)},${Math.round(item.y)}`;
    };
    runInAction(() => {
      workspace.selectMany(ids, false);
      workspace.arrangeSelection('grid', 3, { gap: 10, crop: '1:1' });
    });
    const places = new Set(ids.map(placeOf));
    const before = ids.map(placeOf);
    runInAction(() => workspace.shuffleSelection(4));
    const shuffledOnce = ids.map(placeOf);
    // The same places, taken by others
    expect(new Set(shuffledOnce)).toEqual(places);
    expect(shuffledOnce).not.toEqual(before);
    // The same seed again: the same order
    runInAction(() => workspace.undo());
    expect(ids.map(placeOf)).toEqual(before);
    runInAction(() => workspace.shuffleSelection(4));
    expect(ids.map(placeOf)).toEqual(shuffledOnce);
  });

  it('cuts its video to the beat as one change to undo, another seed another edit', async () => {
    const { store } = setup();
    const workspace = await store.create([
      { label: 'Film', images: images('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h') },
    ]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.cutToTheBeat('cuts', 1);
    });
    const video = workspace.video!;
    expect(videoLength(video)).toBeCloseTo(30, 5);
    expect(video.camera.length).toBeGreaterThan(4);
    expect(video.motions.length).toBeGreaterThan(0);
    const first = JSON.stringify(video.camera.map((stop) => stop.frame));
    runInAction(() => workspace.cutToTheBeat('cuts', 2));
    expect(JSON.stringify(workspace.video!.camera.map((stop) => stop.frame))).not.toBe(first);
    runInAction(() => workspace.undo());
    expect(JSON.stringify(workspace.video!.camera.map((stop) => stop.frame))).toBe(first);
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

  it('sizes what is selected in steps from where it began, as one change to undo', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const before = workspace.toRow().items;
    const width = (id: string) => workspace.items.find((i) => i.id === id)!.width;
    const from = workspace.items.slice();
    runInAction(() => {
      workspace.selectMany(['a', 'b'], false);
      // Steps of one drag: each from the same beginning, so they do not add up
      workspace.scaleSelection(1.5, { x: 0, y: 0 }, from);
      workspace.scaleSelection(2, { x: 0, y: 0 }, from);
    });
    expect(width('a')).toBe(before.find((i) => i.id === 'a')!.width * 2);
    runInAction(() => workspace.undo());
    expect(workspace.toRow().items).toEqual(before);
  });

  it('crops an image in a session, applied as one change to undo', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    const before = workspace.toRow().items;
    const a = () => workspace.items.find((i) => i.id === 'a')!;
    runInAction(() => {
      workspace.select('a', false);
      workspace.startCrop();
    });
    const { photo, frame } = workspace.cropping!;
    // The whole photo is the frame, as the image is whole
    expect(photo).toMatchObject({ x: frame.x, width: frame.width });
    runInAction(() => {
      // The left half
      workspace.adjustCrop({ frame: { ...frame, width: frame.width / 2 } });
      workspace.applyCrop();
    });
    expect(workspace.cropping).toBeUndefined();
    expect(a()).toMatchObject({ width: frame.width / 2, crop: { x: 0, width: 0.5 } });
    runInAction(() => workspace.undo());
    expect(workspace.toRow().items).toEqual(before);
  });

  it('groups layers under a name, locked and selected as one, stored, and undone', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    runInAction(() => workspace.selectMany(['a', 'b'], false));
    const group = runInAction(() => workspace.groupSelection('  Pair  '))!;
    expect(group).toMatchObject({ name: 'Pair', isLocked: true });
    runInAction(() => workspace.select('a', false));
    expect([...workspace.selection].sort()).toEqual(['a', 'b']);
    // Unlocked: one by one
    runInAction(() => {
      workspace.toggleGroupLock(group.id);
      workspace.select('a', false);
    });
    expect([...workspace.selection]).toEqual(['a']);
    await settle();
    const read = (await reopen()).workspaceList[0];
    expect(read.layerGroups.slice()).toEqual([{ ...group, isLocked: false }]);
    expect(read.items.filter((i) => i.groupId === group.id).map((i) => i.id)).toEqual(['a', 'b']);
    // Undone: no group shows
    runInAction(() => workspace.undo());
    expect(workspace.groupsInUse).toEqual([]);
  });

  it('gathers the layers of a new group under the top one of them', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b', 'c') }]);
    const order = () => workspace.layers.map((i) => i.id).filter((id) => id.length === 1);
    const [top, middle, bottom] = order();
    runInAction(() => {
      workspace.selectMany([top, bottom], false);
      workspace.groupSelection('Ends');
    });
    expect(order()).toEqual([top, bottom, middle]);
  });

  it('takes a crop with nothing changed as no change', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const before = workspace.items.slice();
    runInAction(() => {
      workspace.startCrop('a');
      workspace.applyCrop();
    });
    expect(workspace.items.slice()).toEqual(before);
    // Nothing to undo: an undo leaves it as it is
    runInAction(() => workspace.undo());
    expect(workspace.items.slice()).toEqual(before);
  });

  it('makes a video of layouts: selecting one puts everything back, and changes go into it', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const a = () => workspace.items.slice().find((i) => i.id === 'a')!;
    const start = { x: a().x, y: a().y };
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addLayout();
    });
    const first = workspace.selectedBlock!.id;
    // Moved while the first layout is selected: the layout takes it over
    runInAction(() => workspace.moveItems(new Set(['a']), 300, 0));
    expect(workspace.video!.layouts[0].poses.a.x).toBe(start.x + 300);
    // Back where it was, and a second layout with it moved further
    runInAction(() => {
      workspace.moveItems(new Set(['a']), -300, 0);
      workspace.clearBlockSelection();
      workspace.moveItems(new Set(['a']), 500, 0);
      workspace.addLayout();
    });
    expect(workspace.video!.layouts.map((l) => l.poses.a.x)).toEqual([start.x, start.x + 500]);
    // Selecting the first puts a back, as one change to undo
    runInAction(() => workspace.selectBlock('layout', first));
    expect(a().x).toBe(start.x);
    runInAction(() => workspace.undo());
    expect(a().x).toBe(start.x + 500);
    // Stored with the workspace
    await settle();
    const read = (await reopen()).workspaceList[0];
    expect(read.video!.layouts.length).toBe(2);
  });

  it('shows a selected shot over everything where the layout on as it begins has it', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const a = () => workspace.items.slice().find((i) => i.id === 'a')!;
    const start = a().x;
    // Two layouts, a moved in the second, and a shot in each: the workspace shows the second
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addLayout();
      workspace.clearBlockSelection();
      workspace.moveItems(new Set(['a']), 500, 0);
      workspace.addLayout();
      workspace.clearBlockSelection();
      workspace.addCameraStop();
      workspace.addCameraStop();
      workspace.clearBlockSelection();
    });
    const [first, second] = workspace.video!.camera;
    runInAction(() => workspace.selectBlock('camera', first.id));
    expect(a().x).toBe(start);
    runInAction(() => workspace.selectBlock('camera', second.id));
    expect(a().x).toBe(start + 500);
    // Each one change to undo
    runInAction(() => workspace.undo());
    expect(a().x).toBe(start);
    // Locked, nothing moves: it is only shown there, until unlocked
    const shown = () => workspace.shownItems.find((i) => i.id === 'a')!;
    runInAction(() => {
      workspace.toggleLock();
      workspace.selectBlock('camera', second.id);
    });
    expect([a().x, shown().x]).toEqual([start, start + 500]);
    runInAction(() => workspace.toggleLock());
    expect(shown().x).toBe(start);
  });

  it('adds shots beside each other, to be placed, locked once selected, and puts motions on objects', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addCameraStop();
    });
    // The first shot is the frame of the video, being placed
    const first = workspace.video!.camera[0];
    expect(first.frame).toEqual(workspace.video!.frame);
    expect(workspace.isEditingShot).toBe(true);
    runInAction(() => workspace.setShotFrame(first.id, { x: 10, y: 20, width: 90, height: 160 }));
    // The next one beside it, as large, selected and being placed
    runInAction(() => workspace.addCameraStop());
    const second = workspace.video!.camera[1];
    expect(second.frame.x).toBeGreaterThan(10 + 90);
    expect([second.frame.y, second.frame.width, second.frame.height]).toEqual([20, 90, 160]);
    expect(workspace.selectedBlock?.id).toBe(second.id);
    expect(workspace.isEditingShot).toBe(true);
    // Selected again it is locked; Edit shot frees it, Lock shot locks it
    runInAction(() => workspace.selectBlock('camera', first.id));
    expect(workspace.isEditingShot).toBe(false);
    runInAction(() => workspace.editShot());
    expect(workspace.isEditingShot).toBe(true);
    runInAction(() => workspace.lockShot());
    expect(workspace.isEditingShot).toBe(false);
    // A block of another lane: no shot selected, none edited
    runInAction(() => {
      workspace.editShot();
      workspace.addMotion('pop-in', ['a', 'b'], 1);
    });
    expect(workspace.isEditingShot).toBe(false);
    expect(workspace.video!.motions[0]).toMatchObject({
      kind: 'pop-in',
      targets: ['a', 'b'],
      start: 1,
    });
    // Taking a stop off can be undone
    runInAction(() => workspace.removeBlock('camera', workspace.video!.camera[1].id));
    expect(workspace.video!.camera.length).toBe(1);
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera.length).toBe(2);
    // A shot's place typed or nudged step by step (X and Y of the Selected tab): one change to undo
    const shot = workspace.video!.camera[0];
    runInAction(() => {
      workspace.setShotFrame(shot.id, { ...shot.frame, x: 11 });
      workspace.setShotFrame(shot.id, { ...shot.frame, x: 12 }, true);
      workspace.setShotFrame(shot.id, { ...shot.frame, x: 13 }, true);
    });
    expect(workspace.video!.camera[0].frame.x).toBe(13);
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera[0].frame.x).toBe(shot.frame.x);
    // The arrow keys move only the shot being edited; a key held down is one change to undo
    runInAction(() => workspace.selectBlock('camera', shot.id));
    runInAction(() => workspace.nudgeShot(1, 0));
    expect(workspace.video!.camera[0].frame.x).toBe(shot.frame.x);
    runInAction(() => {
      workspace.editShot();
      workspace.nudgeShot(1, 0);
      workspace.nudgeShot(1, 0, true);
      workspace.nudgeShot(0, -10);
    });
    expect(workspace.video!.camera[0].frame).toMatchObject({
      x: shot.frame.x + 2,
      y: shot.frame.y - 10,
    });
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera[0].frame).toMatchObject({
      x: shot.frame.x + 2,
      y: shot.frame.y,
    });
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera[0].frame.x).toBe(shot.frame.x);
  });

  it('duplicates a workspace right after it, with everything on it and its video, and opens it', async () => {
    const { store, reopen, uiStore } = setup();
    const first = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const last = await store.create([]);
    runInAction(() => {
      first.rename('Film');
      first.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      first.addCameraStop();
    });
    const copy = await store.duplicate(first);
    expect(store.workspaceList.map((w) => w.id)).toEqual([first.id, copy.id, last.id]);
    expect(store.workspaceList.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(copy.id).not.toBe(first.id);
    expect(copy.name).toBe('Film copy');
    expect(copy.items.slice()).toEqual(first.items.slice());
    expect(copy.video).toEqual(first.video);
    expect(uiStore.openWorkspace).toHaveBeenCalledWith(copy);
    // Nothing shared: a change to the copy leaves the original as it was
    const before = first.items.slice();
    runInAction(() => copy.moveItems(new Set(['a']), 50, 0));
    expect(first.items.slice()).toEqual(before);
    // A second copy gets a name of its own; both are stored
    expect((await store.duplicate(first)).name).toBe('Film copy 2');
    await settle();
    const read = await reopen();
    expect(read.workspaceList.map((w) => w.name)).toEqual([
      'Film',
      'Film copy 2',
      'Film copy',
      'Workspace 2',
    ]);
  });

  it('undoes a change of the objects without taking back what was changed in the video since', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addCameraStop();
      workspace.clearBlockSelection();
    });
    const stop = workspace.video!.camera[0].id;
    const x = workspace.items.slice().find((i) => i.id === 'a')!.x;
    runInAction(() => {
      workspace.moveItems(new Set(['a']), 100, 0);
      // Not changes to undo: a dragged edge, the end marker, the music
      workspace.setBlockLength('camera', stop, 8);
      workspace.setVideoEnd(6);
    });
    runInAction(() => workspace.undo());
    expect(workspace.items.slice().find((i) => i.id === 'a')!.x).toBe(x);
    expect(workspace.video!.camera[0].length).toBe(8);
    expect(workspace.video!.end).toBe(6);
  });

  it('undoes a change of the video: a shot moved or added, another shape', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addCameraStop();
    });
    const shot = workspace.video!.camera[0];
    runInAction(() => workspace.setShotFrame(shot.id, { ...shot.frame, x: 300 }));
    runInAction(() => workspace.addCameraStop());
    expect(workspace.video!.camera.length).toBe(2);
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera.length).toBe(1);
    expect(workspace.video!.camera[0].frame.x).toBe(300);
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera[0].frame.x).toBe(shot.frame.x);
    // Another shape: undone, the frame has the old shape again
    const { width, height } = workspace.video!;
    runInAction(() => workspace.setVideoSize({ width: 1080, height: 1080 }));
    runInAction(() => workspace.undo());
    expect([workspace.video!.width, workspace.video!.height]).toEqual([width, height]);
    expect(workspace.video!.frame.width / workspace.video!.frame.height).toBeCloseTo(
      width / height,
    );
  });

  it('undoes a change of the objects with a layout selected, the layout along', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addLayout();
    });
    const x = workspace.video!.layouts[0].poses.a.x;
    runInAction(() => workspace.moveItems(new Set(['a']), 100, 0));
    expect(workspace.video!.layouts[0].poses.a.x).toBe(x + 100);
    runInAction(() => workspace.undo());
    expect(workspace.video!.layouts[0].poses.a.x).toBe(x);
  });

  it('never lets a layout take over the workspace when the workspace does not show it', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    const xOf = (layout: number) => workspace.video!.layouts[layout].poses.a.x;
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addLayout();
      workspace.moveItems(new Set(['a']), 300, 0);
      workspace.addLayout();
    });
    const [first, second] = workspace.video!.layouts.map((l) => l.id);
    const [x1, x2] = [xOf(0), xOf(1)];
    // Locked: selecting the first moves nothing, so a setting changed then leaves it alone
    runInAction(() => {
      workspace.toggleLock();
      workspace.selectBlock('layout', first);
      workspace.setVideoOptions({ fps: 60 });
      workspace.toggleLock();
      workspace.moveItems(new Set(['a']), 5, 0);
    });
    expect(xOf(0)).toBe(x1);
    // Selecting the second, undone: the objects are back where the first has them, and the second
    // does not take over the next move
    runInAction(() => workspace.selectBlock('layout', first));
    runInAction(() => workspace.selectBlock('layout', second));
    runInAction(() => workspace.undo());
    runInAction(() => workspace.moveItems(new Set(['a']), 7, 0));
    expect(xOf(1)).toBe(x2);
  });

  it('leaves nothing to redo once a setting of the video changes', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addCameraStop();
    });
    runInAction(() => workspace.undo());
    runInAction(() => workspace.setVideoOptions({ fps: 60 }));
    runInAction(() => workspace.redo());
    expect(workspace.video!.camera.length).toBe(0);
    expect(workspace.video!.fps).toBe(60);
  });

  it('lets the video be edited and undone while the objects are locked', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.toggleLock();
      workspace.addCameraStop();
      workspace.moveItems(new Set(['a']), 100, 0);
    });
    expect(workspace.video!.camera.length).toBe(1);
    runInAction(() => workspace.undo());
    expect(workspace.video!.camera.length).toBe(0);
  });

  it('keeps the music within the song: never a start or a skip below 0', async () => {
    const { store } = setup();
    const workspace = await store.create([]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.setMusic({
        path: 'song.mp3',
        name: 'Song',
        start: 0,
        trim: 0,
        duration: 0.5,
        volume: 1,
        bpm: 0,
        beats: [],
      });
      workspace.changeMusic({ trim: 3, start: -2, volume: 4 });
    });
    expect(workspace.video!.music).toMatchObject({ trim: 0, start: 0, volume: 1 });
  });

  it('moves the end marker to the end of a camera stop that is added', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a') }]);
    runInAction(() => {
      workspace.startVideo({ x: 0, y: 0, width: 1000, height: 1000 });
      workspace.addCameraStop();
      workspace.setVideoEnd(2.5);
    });
    expect(videoLength(workspace.video!)).toBe(2.5);
    runInAction(() => workspace.addCameraStop());
    expect(videoLength(workspace.video!)).toBe(2 * DEFAULT_BLOCK_LENGTH);
    // Undone with the stop
    runInAction(() => workspace.undo());
    expect(videoLength(workspace.video!)).toBe(2.5);
  });

  it('ungroups what is selected, its layers staying where they are', async () => {
    const { store } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const before = workspace.items.slice().map((i) => [i.x, i.y]);
    runInAction(() => {
      workspace.selectMany(['a', 'b'], false);
      workspace.groupSelection('Pair');
      workspace.select('a', false);
      workspace.ungroupSelection();
    });
    expect(workspace.groupsInUse).toEqual([]);
    expect(workspace.items.slice().map((i) => [i.x, i.y])).toEqual(before);
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

  it('duplicates selected objects with one undo step and keeps them after a restart', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    runInAction(() => {
      workspace.selectAll();
      workspace.duplicateSelection();
    });
    expect(workspace.items).toHaveLength(6);
    expect(workspace.fileIds).toEqual(['a', 'b']);
    expect(workspace.selection.size).toBe(3);
    await settle();
    const read = (await reopen()).workspaceList[0];
    expect(read.items).toHaveLength(6);
    runInAction(() => workspace.undo());
    expect(workspace.items).toHaveLength(3);
  });

  it('adds, edits and removes photo borders with undo and storage round-trip', async () => {
    const { store, reopen } = setup();
    const workspace = await store.create([{ label: 'Film', images: images('a', 'b') }]);
    const before = workspace.items.find((i) => i.id === 'a')!;
    runInAction(() => {
      workspace.selectMany(['a', 'b'], false);
      workspace.setImageBorder(new Set(workspace.selection), {
        mode: 'split',
        topBottom: 24,
        sides: 12,
        color: '#ffffff',
      });
    });
    const bordered = workspace.items.find((i) => i.id === 'a')!;
    expect(bordered.width).toBe(before.width + 24);
    expect(bordered.height).toBe(before.height + 48);
    await settle();
    const read = (await reopen()).workspaceList[0];
    const loaded = read.items.find((i) => i.id === 'a')!;
    expect(loaded.kind === 'image' && loaded.border).toEqual({
      mode: 'split',
      topBottom: 24,
      sides: 12,
      color: '#ffffff',
    });
    runInAction(() => workspace.undo());
    expect(workspace.items.find((i) => i.id === 'a')).toEqual(before);
  });
});

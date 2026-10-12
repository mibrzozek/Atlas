import {
  collectionFromRow,
  collectionToRow,
  moveItem,
  sortedByName,
  uniqueName,
} from '../common/collections';

describe('collections as rows of the saved searches', () => {
  const collection = { id: 'c1', name: 'Travel', tagIds: ['t1', 't2', 't3'], index: 2 };

  it('survives being stored and read back', () => {
    expect(collectionFromRow(collectionToRow(collection))).toEqual(collection);
    const empty = { id: 'c2', name: 'Empty', tagIds: [], index: 0 };
    expect(collectionFromRow(collectionToRow(empty))).toEqual(empty);
  });

  it('is stored as a search for any of its tags, which the original app can open', () => {
    const row = collectionToRow(collection);
    expect(row.matchAny).toBe(true);
    expect(row.criteria).toEqual([
      { key: 'tags', valueType: 'array', operator: 'contains', value: ['t1'] },
      { key: 'tags', valueType: 'array', operator: 'contains', value: ['t2'] },
      { key: 'tags', valueType: 'array', operator: 'contains', value: ['t3'] },
    ]);
  });

  it('leaves ordinary saved searches alone', () => {
    const { isCollection, ...savedSearch } = collectionToRow(collection);
    expect(isCollection).toBe(true);
    expect(collectionFromRow(savedSearch)).toBeUndefined();
  });

  it('copes with damaged rows', () => {
    const row = {
      ...collectionToRow(collection),
      criteria: [
        { key: 'tags', valueType: 'array', operator: 'contains', value: ['t1'] },
        { key: 'tags', valueType: 'array', operator: 'contains', value: ['t1'] },
        { key: 'name', valueType: 'string', operator: 'contains', value: 'x' },
        { key: 'tags', valueType: 'array', operator: 'contains', value: [] },
      ],
    };
    expect(collectionFromRow(row)?.tagIds).toEqual(['t1']);
    expect(collectionFromRow({ ...row, criteria: undefined as any })?.tagIds).toEqual([]);
  });
});

describe('sortedByName', () => {
  it('sorts alphabetically, numbers by their value, and leaves the original list alone', () => {
    const items = [{ name: 'shoot 10' }, { name: 'Zebra' }, { name: 'Shoot 2' }, { name: 'apple' }];
    expect(sortedByName(items).map((i) => i.name)).toEqual([
      'apple',
      'Shoot 2',
      'shoot 10',
      'Zebra',
    ]);
    expect(items[0].name).toBe('shoot 10');
  });
});

describe('moveItem', () => {
  const items = ['a', 'b', 'c', 'd'];

  it('moves an item to the given position of the result', () => {
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(items, 1, 1)).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps positions inside the list', () => {
    expect(moveItem(items, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(items, 2, -5)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveItem(items, 9, 0)).toEqual(items);
  });
});

describe('uniqueName', () => {
  it('adds a number when the name is taken', () => {
    expect(uniqueName('New collection', [])).toBe('New collection');
    expect(uniqueName('New collection', ['new collection'])).toBe('New collection 2');
    expect(uniqueName('New collection', ['New collection', 'New collection 2 '])).toBe(
      'New collection 3',
    );
  });
});

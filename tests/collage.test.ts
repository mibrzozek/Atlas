import { applyCollageOrder, collageKey, moveInCollage, swapInCollage } from '../common/collage';

describe('applyCollageOrder', () => {
  it('puts the images in the remembered order', () => {
    expect(applyCollageOrder(['a', 'b', 'c', 'd'], ['c', 'a', 'd', 'b'])).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
  });

  it('adds new images at the end and skips the ones that are gone', () => {
    expect(applyCollageOrder(['a', 'b', 'new1', 'c', 'new2'], ['c', 'gone', 'a', 'b'])).toEqual([
      'c',
      'a',
      'b',
      'new1',
      'new2',
    ]);
  });

  it('never loses or doubles an image', () => {
    const ids = ['a', 'b', 'c'];
    expect(applyCollageOrder(ids, []).sort()).toEqual(ids);
    expect(applyCollageOrder(ids, ['b', 'b', 'x', 'a', 'b'])).toEqual(['b', 'a', 'c']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('moveInCollage', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('moves one image before or after another', () => {
    expect(moveInCollage(ids, ['e'], 'b', 'before')).toEqual(['a', 'e', 'b', 'c', 'd']);
    expect(moveInCollage(ids, ['a'], 'c', 'after')).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(moveInCollage(ids, ['a'], 'e', 'after')).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(moveInCollage(ids, ['c'], 'a', 'before')).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('moves several images together, keeping their order', () => {
    expect(moveInCollage(ids, ['e', 'a'], 'c', 'after')).toEqual(['b', 'c', 'a', 'e', 'd']);
  });

  it('changes nothing when dropped on itself or on something unknown', () => {
    expect(moveInCollage(ids, ['b'], 'b', 'before')).toEqual(ids);
    expect(moveInCollage(ids, ['a', 'b'], 'a', 'after')).toEqual(ids);
    expect(moveInCollage(ids, ['a'], 'zzz', 'after')).toEqual(ids);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps every image exactly once', () => {
    for (const target of ids) {
      for (const place of ['before', 'after'] as const) {
        const result = moveInCollage(ids, ['b', 'd', 'unknown'], target, place);
        expect(result.slice().sort()).toEqual(ids);
      }
    }
  });
});

describe('swapInCollage', () => {
  it('switches two images', () => {
    expect(swapInCollage(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['d', 'b', 'c', 'a']);
    expect(swapInCollage(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
    expect(swapInCollage(['a', 'b', 'c'], 'a', 'zzz')).toEqual(['a', 'b', 'c']);
  });
});

describe('collageKey', () => {
  const tag = (value: string) => ({ key: 'tags', operator: 'containsRecursively', value });

  it('is the same for the same view, whatever order it was put together in', () => {
    expect(collageKey('query', true, [tag('t1'), tag('t2')])).toBe(
      collageKey('query', true, [tag('t2'), tag('t1')]),
    );
  });

  it('differs between views', () => {
    const keys = [
      collageKey('all', false, []),
      collageKey('untagged', false, []),
      collageKey('query', false, [tag('t1')]),
      collageKey('query', false, [tag('t2')]),
      collageKey('query', false, [tag('t1'), tag('t2')]),
      collageKey('query', true, [tag('t1'), tag('t2')]),
      collageKey('query', false, [{ key: 'absolutePath', operator: 'startsWith', value: 'C:/a/' }]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ignores "any or all" for a single criteria', () => {
    expect(collageKey('query', true, [tag('t1')])).toBe(collageKey('query', false, [tag('t1')]));
  });
});

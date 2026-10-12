/**
 * A collection is a named group of tags. A tag can be in any number of collections.
 *
 * Collections are kept in the database's table of saved searches, as a search for "any of these tags" with a
 * mark on it. That needs no change to the database schema, they are part of every backup, and the original
 * Allusion shows them as ordinary saved searches that find the same images.
 */
export interface CollectionData {
  id: string;
  name: string;
  /** The tags of the collection, in the order they were added */
  tagIds: string[];
  /** Its place in the list when sorted by hand */
  index: number;
}

/** A row of the saved-searches table, as far as collections are concerned */
export interface CollectionRow {
  id: string;
  name: string;
  criteria: { key: string; valueType: string; operator: string; value: unknown }[];
  matchAny?: boolean;
  index: number;
  isCollection?: boolean;
}

export function collectionToRow({ id, name, tagIds, index }: CollectionData): CollectionRow {
  return {
    id,
    name,
    // One criteria for every tag: that is how the gallery searches for any of them
    criteria: tagIds.map((tagId) => ({
      key: 'tags',
      valueType: 'array',
      operator: 'contains',
      value: [tagId],
    })),
    matchAny: true,
    index,
    isCollection: true,
  };
}

/** Returns nothing for a row that is an ordinary saved search */
export function collectionFromRow(row: CollectionRow): CollectionData | undefined {
  if (row.isCollection !== true) {
    return undefined;
  }
  const tagIds: string[] = [];
  for (const crit of Array.isArray(row.criteria) ? row.criteria : []) {
    const tagId = Array.isArray(crit?.value) ? crit.value[0] : undefined;
    if (crit?.key === 'tags' && typeof tagId === 'string' && !tagIds.includes(tagId)) {
      tagIds.push(tagId);
    }
  }
  return {
    id: row.id,
    name: String(row.name ?? ''),
    tagIds,
    index: Number.isFinite(row.index) ? row.index : 0,
  };
}

/** How the lists of tags and collections in the outliner are ordered */
export type OutlinerSort = 'manual' | 'name';

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Returns the items in alphabetical order ("Shoot 2" before "Shoot 10"), without changing the given list */
export function sortedByName<T extends { name: string }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => byName.compare(a.name, b.name));
}

/**
 * Returns the list with the item at `from` moved so that it ends up at position `to` of the result.
 * Positions outside the list are brought back into it.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const result = items.slice();
  if (from < 0 || from >= result.length) {
    return result;
  }
  const [item] = result.splice(from, 1);
  result.splice(Math.min(Math.max(to, 0), result.length), 0, item);
  return result;
}

/** A name that is not in use yet: "New collection", "New collection 2", ... */
export function uniqueName(base: string, taken: readonly string[]): string {
  const lowerTaken = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!lowerTaken.has(base.toLowerCase())) {
    return base;
  }
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!lowerTaken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

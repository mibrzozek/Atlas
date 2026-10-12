/**
 * Collage mode: the images of a view are in an order made by hand, by dragging them around.
 * The order is remembered for every view (a tag, a folder, a search) on its own, as a list of image ids.
 */

/** Marks a drag of an image to another place of the collage */
export const COLLAGE_DND_TYPE = 'application/x-atlas-collage';

/** More images than this are not put in a hand-made order: the list of ids is stored as a whole */
export const MAX_COLLAGE_IMAGES = 5000;

/**
 * Returns the ids in the remembered order. Ids that are not in that order (images that were added since)
 * follow at the end, in the order they came in; remembered ids that are gone are skipped.
 */
export function applyCollageOrder(ids: readonly string[], savedOrder: readonly string[]): string[] {
  const present = new Set(ids);
  const result: string[] = [];
  const placed = new Set<string>();
  for (const id of savedOrder) {
    if (present.has(id) && !placed.has(id)) {
      result.push(id);
      placed.add(id);
    }
  }
  for (const id of ids) {
    if (!placed.has(id)) {
      result.push(id);
      placed.add(id);
    }
  }
  return result;
}

/**
 * Returns the ids with the moved ones taken out and put back together, in the order they were in,
 * right before or right after the target. Moving something onto itself changes nothing.
 */
export function moveInCollage(
  ids: readonly string[],
  movedIds: readonly string[],
  targetId: string,
  place: 'before' | 'after',
): string[] {
  const moved = new Set(movedIds);
  if (moved.has(targetId) || !ids.includes(targetId)) {
    return ids.slice();
  }
  const movedInOrder = ids.filter((id) => moved.has(id));
  const rest = ids.filter((id) => !moved.has(id));
  const targetIndex = rest.indexOf(targetId);
  rest.splice(place === 'before' ? targetIndex : targetIndex + 1, 0, ...movedInOrder);
  return rest;
}

/** Returns the ids with the two given ones in each other's place */
export function swapInCollage(ids: readonly string[], a: string, b: string): string[] {
  const result = ids.slice();
  const indexA = result.indexOf(a);
  const indexB = result.indexOf(b);
  if (indexA !== -1 && indexB !== -1) {
    [result[indexA], result[indexB]] = [result[indexB], result[indexA]];
  }
  return result;
}

/**
 * What a view is known by: the same tag, folder or search gives the same key, in whatever order
 * its parts were added.
 */
export function collageKey(
  content: string,
  matchAny: boolean,
  criteria: readonly { key: string; operator: string; value: unknown }[],
): string {
  if (criteria.length === 0) {
    return content;
  }
  const parts = criteria.map((c) => `${c.key}|${c.operator}|${String(c.value ?? '')}`).sort();
  return `${content}:${parts.length > 1 && matchAny ? 'any' : 'all'}:${parts.join('&')}`;
}

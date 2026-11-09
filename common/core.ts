export function clamp(value: number, min: number, max: number): number {
  if (value > max) {
    return max;
  } else if (value < min) {
    return min;
  } else {
    return value;
  }
}

/** Returns the items in a random order, without changing the given list */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Numbers from 0 up to 1 that look random but are the same every time for the same `seed` (mulberry32):
 * for a variation that can be asked for again
 */
export function seededRandom(seed: number): () => number {
  let state = Math.floor(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `items` in an order that looks random but is the same every time for the same `seed`, whatever order
 * they come in: one that is added or left out does not move the others
 */
export function shuffledBySeed<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  seed: number,
): T[] {
  const rank = (id: string) => {
    let hash = Math.floor(seed) >>> 0;
    for (let i = 0; i < id.length; i++) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 0x9e3779b1) >>> 0;
    }
    return seededRandom(hash)();
  };
  return items
    .map((item) => ({ item, rank: rank(idOf(item)) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

/** Retains only the elements specified by the predicate.
 *
 * In other words, remove all elements e such that f(&e) returns false. This method operates in place,
 * visiting each element exactly once in the original order, and preserves the order of the
 * retained elements.
 */
export function retainArray<T>(array: T[], predicate: (element: T, index: number) => boolean) {
  let deleteCount = 0;
  let i = 0;
  const len = array.length;
  while (i !== len) {
    const result = predicate(array[i], i);
    i += 1;
    if (!result) {
      deleteCount = 1;
      break;
    }
  }
  // This will only be executed if deleteCount is greater than 0; thus the check can be
  // omitted when the predicate becomes true.
  while (i !== len) {
    if (!predicate(array[i], i)) {
      deleteCount += 1;
    } else {
      // Move retained element to the beginning of the hole (deleted elements). Doing so will
      // shift the hole to the end of the array.
      const holeSlot = i - deleteCount;
      swap(array, holeSlot, i);
    }
    i += 1;
  }
  array.length = len - deleteCount;
}

export function notEmpty<TValue>(value: TValue): value is NonNullable<TValue> {
  return value !== null && value !== undefined;
}

export function swap<T>(array: Array<T>, x: number, y: number): void {
  [array[x], array[y]] = [array[y], array[x]];
}

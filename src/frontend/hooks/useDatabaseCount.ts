import { useEffect, useState } from 'react';

import { useStore } from '../contexts/StoreContext';

/**
 * A number that is counted in the database, and counted again whenever the images change.
 * Undefined until the first count is in, and while `key` is undefined (nothing to count).
 *
 * @param key What is being counted: a new key means a new count
 */
export default function useDatabaseCount<T>(
  count: () => Promise<T>,
  key: string | undefined,
): T | undefined {
  const { fileStore } = useStore();
  const [result, setResult] = useState<T>();
  const { numTotalFiles, numSaves, fileListLastModified } = fileStore;

  useEffect(() => {
    if (key === undefined) {
      setResult(undefined);
      return;
    }
    let isCurrent = true;
    const update = () =>
      count()
        .then((value) => isCurrent && setResult(value))
        .catch(console.error);
    // A moment later: a row of changes then leads to one count
    const handle = window.setTimeout(update, 150);
    return () => {
      isCurrent = false;
      window.clearTimeout(handle);
    };
    // What is counted is in the key. A tag that is added or removed shows up in `numSaves`,
    // once it is in the database
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, numTotalFiles, numSaves, fileListLastModified]);

  return result;
}

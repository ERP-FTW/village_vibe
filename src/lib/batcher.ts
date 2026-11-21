/**
 * Collects lookups made within a short window and resolves them with one request.
 *
 * Cards in a feed each ask for "their" author profile or badges; without batching a
 * 50-card feed sends 50+ separate REQs (each to several relays). With a batcher those
 * lookups are merged into one request per window.
 */
export function createBatcher<K, V>(
  run: (keys: K[]) => Promise<Map<K, V>>,
  { delayMs = 15, maxBatch = 100 }: { delayMs?: number; maxBatch?: number } = {},
): (key: K) => Promise<V | undefined> {
  let queue = new Map<K, Array<{ resolve: (value: V | undefined) => void; reject: (error: unknown) => void }>>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    const batch = queue;
    queue = new Map();
    timer = undefined;
    const keys = [...batch.keys()];
    for (let i = 0; i < keys.length; i += maxBatch) {
      const chunk = keys.slice(i, i + maxBatch);
      run(chunk).then(
        result => chunk.forEach(key => batch.get(key)?.forEach(({ resolve }) => resolve(result.get(key)))),
        error => chunk.forEach(key => batch.get(key)?.forEach(({ reject }) => reject(error))),
      );
    }
  };

  return (key: K) => new Promise<V | undefined>((resolve, reject) => {
    const waiting = queue.get(key) ?? [];
    waiting.push({ resolve, reject });
    queue.set(key, waiting);
    timer ??= setTimeout(flush, delayMs);
  });
}

/** One batcher per store instance (e.g. per relay pool). */
export function batcherPerStore<S extends object, K, V>(
  create: (store: S) => (key: K) => Promise<V | undefined>,
): (store: S) => (key: K) => Promise<V | undefined> {
  const batchers = new WeakMap<S, (key: K) => Promise<V | undefined>>();
  return (store: S) => {
    let batcher = batchers.get(store);
    if (!batcher) {
      batcher = create(store);
      batchers.set(store, batcher);
    }
    return batcher;
  };
}

/** Bounded, memory-only view preferences. No engineering records or credentials. */
export function createViewStateStore(limit = 64) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid view-state limit');
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  function prune(protectedKey?: string) {
    for (const key of values.keys()) {
      if (values.size <= limit) break;
      if (key !== protectedKey && !listeners.get(key)?.size) values.delete(key);
    }
  }
  return {
    read<T>(key: string, initial: T): T {
      if (!values.has(key)) { values.set(key, initial); prune(key); }
      return (values.has(key) ? values.get(key) : initial) as T;
    },
    write<T>(key: string, next: T) {
      if (Object.is(values.get(key), next)) return;
      values.delete(key);
      values.set(key, next);
      prune(key);
      for (const listener of listeners.get(key) || []) listener();
    },
    subscribe(key: string, listener: () => void) {
      let group = listeners.get(key);
      if (!group) { group = new Set(); listeners.set(key, group); }
      group.add(listener);
      return () => { group!.delete(listener); if (!group!.size) listeners.delete(key); prune(); };
    },
    get size() { return values.size; },
  };
}

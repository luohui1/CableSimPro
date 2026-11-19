type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const escape = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const identity = (value: unknown) => {
  const row = object(value);
  return row && [row.id, row.role, row.cable].find((key): key is string => typeof key === 'string' && !!key);
};

/** Count edited input locations, not object size or duplicated provenance records. */
export function inputChangePaths(before: unknown, after: unknown, pending: Iterable<string> = []): string[] {
  const changed = new Set<string>(pending);
  const sources = new Set<string>();
  function visit(left: unknown, right: unknown, path: string) {
    if (Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const oldKeys = left.map(identity), newKeys = right.map(identity);
      const keyed = [...oldKeys, ...newKeys].every(Boolean)
        && new Set(oldKeys).size === oldKeys.length && new Set(newKeys).size === newKeys.length;
      if (keyed) {
        const oldRows = new Map(left.map((row, index) => [oldKeys[index], row]));
        const newRows = new Map(right.map((row, index) => [newKeys[index], row]));
        for (const key of new Set([...oldKeys, ...newKeys]))
          visit(oldRows.get(key), newRows.get(key), path + '/' + escape(key!));
        if (oldKeys.length === newKeys.length && oldKeys.every(key => newRows.has(key))
          && oldKeys.some((key, index) => key !== newKeys[index])) changed.add(path);
      } else if (left.length === right.length) {
        left.forEach((row, index) => visit(row, right[index], path + '/' + index));
      } else changed.add(path);
      return;
    }
    const oldObject = object(left), newObject = object(right);
    if (oldObject && newObject) {
      for (const key of new Set([...Object.keys(oldObject), ...Object.keys(newObject)])) {
        if (key === 'provenance' || key === 'input_sources') {
          const oldSources = object(oldObject[key]) || {}, newSources = object(newObject[key]) || {};
          for (const source of new Set([...Object.keys(oldSources), ...Object.keys(newSources)]))
            if (JSON.stringify(oldSources[source]) !== JSON.stringify(newSources[source]))
              sources.add(path + (source.startsWith('/') ? source : '/' + escape(source)));
        } else visit(oldObject[key], newObject[key], path + '/' + escape(key));
      }
    } else changed.add(path || '/');
  }
  visit(before, after, '');
  for (const source of sources)
    if (![...changed].some(path => path === source || path.startsWith(source + '/') || source.startsWith(path + '/')))
      changed.add(source);
  // Replacing/removing one object is one change, including its stale child fields.
  return [...changed].filter(path => ![...changed].some(parent => parent !== path && path.startsWith(parent + '/')));
}

export function countInputChanges(before: unknown, after: unknown, pending: Iterable<string> = []): number {
  return inputChangePaths(before, after, pending).length;
}

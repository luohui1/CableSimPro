import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { createViewStateStore } from './view-state';

const store = createViewStateStore();

/** Key must include workspace, study, current/frozen input and object scope. */
export function useViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => store.read(key, initial), [key, initial]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const previous = store.read(key, initial);
    store.write(key, typeof next === 'function' ? (next as (value: T) => T)(previous) : next);
  }, [key, initial]);
  return [value, update];
}

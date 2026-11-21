import { useState, useEffect, useCallback, useRef } from 'react';

/** Fired on window when a value is written through this hook, so other instances in the same tab update. */
const LOCAL_STORAGE_EVENT = 'app:local-storage';

/**
 * Generic hook for managing localStorage state.
 *
 * All instances using the same key stay in sync, in this tab and in other tabs,
 * and the value is re-read when the key changes (e.g. a per-user key after login).
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  }
) {
  const serialize = serializer?.serialize || JSON.stringify;
  const deserialize = serializer?.deserialize || JSON.parse;

  // Keep the latest helpers without making them effect dependencies.
  const helpers = useRef({ serialize, deserialize, defaultValue });
  helpers.current = { serialize, deserialize, defaultValue };

  const read = useCallback((): T => {
    try {
      const item = localStorage.getItem(key);
      return item ? helpers.current.deserialize(item) : helpers.current.defaultValue;
    } catch (error) {
      console.warn(`Failed to load ${key} from localStorage:`, error);
      return helpers.current.defaultValue;
    }
  }, [key]);

  const [state, setState] = useState<T>(read);

  // Re-read when the key changes.
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    setLoadedKey(key);
    setState(read());
  }

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState(prev => {
      const valueToStore = value instanceof Function ? value(prev) : value;
      try {
        localStorage.setItem(key, helpers.current.serialize(valueToStore));
        // Notify other hook instances after this render pass.
        queueMicrotask(() => window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_EVENT, { detail: key })));
      } catch (error) {
        console.warn(`Failed to save ${key} to localStorage:`, error);
      }
      return valueToStore;
    });
  }, [key]);

  // Sync with writes from other hook instances (same tab) and other tabs.
  useEffect(() => {
    const sync = () => setState(read());
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key) sync();
    };
    const handleLocal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) sync();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(LOCAL_STORAGE_EVENT, handleLocal);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(LOCAL_STORAGE_EVENT, handleLocal);
    };
  }, [key, read]);

  return [state, setValue] as const;
}

import { useCallback, useSyncExternalStore } from 'react';

/** Subscribes to a CSS media query. Without matchMedia it assumes the query matches. */
export function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  const getSnapshot = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches);

  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

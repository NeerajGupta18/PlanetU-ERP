import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/http.js';

/** GET a path; re-fetches when `path` changes. Keeps the previous data visible while reloading. */
export function useFetch(path) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path, { signal: ctrl.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setState((s) => ({ ...s, loading: false, error }));
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

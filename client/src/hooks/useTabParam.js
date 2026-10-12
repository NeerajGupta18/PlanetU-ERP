import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps the active tab in the address bar (?tab=fees) so a refresh or the browser's
 * back button lands on the same tab. Unknown values fall back to the default.
 *   const [tab, setTab] = useTabParam('catalogue', ['catalogue', 'issued']);
 */
export function useTabParam(defaultTab, allowed) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = raw && (!allowed || allowed.includes(raw)) ? raw : defaultTab;
  const setTab = useCallback((next) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (next === defaultTab) n.delete('tab'); else n.set('tab', next);
      return n;
    }, { replace: true });
  }, [setParams, defaultTab]);
  return [tab, setTab];
}

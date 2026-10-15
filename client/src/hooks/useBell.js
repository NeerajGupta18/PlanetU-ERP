import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/http.js';

const EMPTY = { items: [], reminders: [], unread: 0, counts: {}, total: 0 };

/**
 * The bell's contents for the signed-in user: stored messages, today's reminders and the menu badge counts.
 * Refreshed when the page changes, every minute while the tab is visible, and after marking something read.
 */
export function useBell(enabled) {
  const [data, setData] = useState(EMPTY);
  const { pathname } = useLocation();
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || busy.current) return;
    busy.current = true;
    try { setData(await api.get('/me/notifications')); } catch { /* the bell is not worth an error message */ } finally { busy.current = false; }
  }, [enabled]);

  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(t);
  }, [enabled, load]);

  const markRead = useCallback(async (id) => {
    setData((d) => ({ ...d, items: d.items.map((n) => (n.id === id ? { ...n, read: true } : n)), unread: Math.max(0, d.unread - 1), total: Math.max(0, d.total - 1) }));
    try { await api.post(`/me/notifications/${id}/read`); } catch { /* shown read either way */ }
  }, []);
  const markAll = useCallback(async () => {
    try { await api.post('/me/notifications/read-all'); } finally { load(); }
  }, [load]);

  return { ...data, reload: load, markRead, markAll };
}

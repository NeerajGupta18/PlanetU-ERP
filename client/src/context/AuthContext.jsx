import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/http.js';

const AuthContext = createContext(null);
const EMPTY = { user: null, tenant: null, institute: null, notifications: [] };

/**
 * Sign-out leaves nothing of that person on the device: a full page load drops every fetched answer held in memory,
 * and session storage goes too. The chosen child lives in an httpOnly cookie that the server clears. What stays in
 * local storage is only about this device (institute code, sidebar layout).
 */
function forgetUser() {
  try { sessionStorage.clear(); } catch { /* storage blocked */ }
  window.location.replace('/login');
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  // Restore the session (httpOnly cookie) on first load
  useEffect(() => {
    api.get('/auth/session')
      .then((s) => setSession(s.user ? s : EMPTY))
      .catch(() => setSession(EMPTY))
      .finally(() => setLoading(false));
  }, []);

  // Any protected API call that answers 401 ends the session on the client too
  useEffect(() => {
    const onExpired = () => setSession(EMPTY);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (credentials) => {
    const s = await api.post('/auth/login', credentials);
    try { sessionStorage.clear(); } catch { /* storage blocked */ }
    setSession(s);
    return s.user;
  }, []);

  // Re-reads the session (e.g. after the password was changed and the 'must change' flag cleared)
  const refresh = useCallback(async () => { const s = await api.get('/auth/me'); setSession(s); return s; }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setSession(EMPTY);
      forgetUser();
    }
  }, []);

  const value = useMemo(() => ({ ...session, loading, login, logout, refresh }), [session, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

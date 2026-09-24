import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState({ user: null, institute: null, notifications: [] });
  const [loading, setLoading] = useState(true);

  // Restore the session (httpOnly cookie) on first load
  useEffect(() => {
    api.get('/auth/me')
      .then((s) => setSession(s))
      .catch(() => setSession({ user: null, institute: null, notifications: [] }))
      .finally(() => setLoading(false));
  }, []);

  // Any protected API call that answers 401 ends the session on the client too
  useEffect(() => {
    const onExpired = () => setSession({ user: null, institute: null, notifications: [] });
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (credentials) => {
    const s = await api.post('/auth/login', credentials);
    setSession(s);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setSession({ user: null, institute: null, notifications: [] });
    }
  }, []);

  const value = useMemo(() => ({ ...session, loading, login, logout }), [session, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

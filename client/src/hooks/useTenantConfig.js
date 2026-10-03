import { useAuth } from '../context/AuthContext.jsx';

/**
 * The signed-in institute's configuration: which modules are on and what things
 * are called. `t('students', 'Students')` returns the institute's own word
 * ("Trainees", "Members"...) and falls back to the default.
 */
export function useTenantConfig() {
  const { tenant } = useAuth();
  const terms = tenant?.terminology || {};
  return {
    tenant,
    hasModule: (key) => !key || !tenant || tenant.modules.includes(key),
    t: (key, fallback) => terms[key] || fallback || key,
  };
}

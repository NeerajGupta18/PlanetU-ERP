import { useAuth } from '../context/AuthContext.jsx';

export const CHECKIN_TYPES = ['college', 'university'];

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
    hasModule: (key) => {
      if (!key || !tenant) return true;
      // QR check-in is part of Attendance for colleges and universities; a school's class teacher marks instead
      if (key === 'qr_checkin') return tenant.modules.includes('attendance') && CHECKIN_TYPES.includes(tenant.type);
      return tenant.modules.includes(key);
    },
    t: (key, fallback) => terms[key] || fallback || key,
  };
}

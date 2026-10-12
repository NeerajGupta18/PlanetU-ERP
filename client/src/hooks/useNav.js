import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTenantConfig } from './useTenantConfig.js';
import { MENU_TREE } from '../config/menu.config.js';

/**
 * The sidebar for the signed-in user, already filtered:
 *  - modules the institute has switched off are removed (and groups left empty disappear)
 *  - while billing is locked the admin only sees Billing
 *  - labels use the institute's own words
 * Returns { tree, flat } where `flat` is every link with its group name (used by search and breadcrumbs).
 */
export function useNav() {
  const { user, tenant } = useAuth();
  const { hasModule, t } = useTenantConfig();
  const locked = Boolean(tenant?.billingLocked);

  return useMemo(() => {
    const keep = (m) => hasModule(m.module) && (!locked || m.to === '/admin/billing');
    const label = (m) => (m.term ? t(m.term[0], m.term[1]) : m.label);
    const tree = [];
    (MENU_TREE[user?.role] || []).forEach((entry) => {
      if (entry.group) {
        const items = entry.items.filter(keep).map((m) => ({ ...m, text: label(m), group: entry.group }));
        if (items.length) tree.push({ ...entry, items });
      } else if (keep(entry)) {
        tree.push({ ...entry, text: label(entry), group: null });
      }
    });
    const flat = tree.flatMap((e) => (e.group ? e.items : [e]));
    return { tree, flat };
    // hasModule / t are recreated each render but only depend on tenant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, tenant, locked]);
}

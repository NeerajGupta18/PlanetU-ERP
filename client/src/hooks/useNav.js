import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTenantConfig } from './useTenantConfig.js';
import { MENU_TREE } from '../config/menu.config.js';

/** True when `pathname` is the page `to` or one of its detail pages. */
export const onPage = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * The sidebar for the signed-in user, already filtered:
 *  - modules the institute has switched off are removed (and groups left empty disappear)
 *  - while billing is locked the admin only sees the subscription page
 *  - labels use the institute's own words
 *  - an item with `sections` keeps only the sections that are switched on; with one left it becomes a plain link
 * Returns { tree, flat }:
 *  tree - what the sidebar draws; every link has `to` (where it opens) and `match` (every path that lights it up)
 *  flat - every page by itself, sections included, with its group and parent item (used by search and breadcrumbs)
 */
export function useNav() {
  const { user, tenant } = useAuth();
  const { hasModule, t } = useTenantConfig();
  const locked = Boolean(tenant?.billingLocked);

  return useMemo(() => {
    const label = (m) => (m.term ? t(m.term[0], m.term[1]) : m.label);
    const visible = (m) => hasModule(m.module) && (!locked || m.to === '/admin/billing');

    /** Turns one menu link into its sidebar form, or null when nothing in it is switched on. */
    const build = (m, group) => {
      if (!m.sections) return visible(m) ? { ...m, text: label(m), group, match: [m.to] } : null;
      const sections = m.sections.filter(visible).map((s) => ({ ...s, text: label(s) }));
      if (!sections.length) return null;
      if (sections.length === 1) return { ...m, to: sections[0].to, text: sections[0].text, group, match: [sections[0].to], sections: undefined };
      return { ...m, to: sections[0].to, text: label(m), group, sections, match: sections.map((s) => s.to) };
    };

    const tree = [];
    (MENU_TREE[user?.role] || []).forEach((entry) => {
      if (entry.group) {
        const items = entry.items.map((m) => build(m, entry.group)).filter(Boolean);
        if (items.length) tree.push({ ...entry, items });
      } else {
        const item = build(entry, null);
        if (item) tree.push(item);
      }
    });

    const links = tree.flatMap((e) => (e.items ? e.items : [e]));
    const flat = links.flatMap((i) => (i.sections
      ? i.sections.map((s) => ({ ...s, icon: i.icon, group: i.group, parent: i.text, parentTo: i.to }))
      : [i]));
    return { tree, flat, links };
    // hasModule / t are recreated each render but only depend on tenant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, tenant, locked]);
}

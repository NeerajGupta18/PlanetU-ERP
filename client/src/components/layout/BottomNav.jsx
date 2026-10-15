import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { BOTTOM_NAV } from '../../config/menu.config.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { onPage, useNav } from '../../hooks/useNav.js';

/** Phones only: the four pages this role opens most, and "Menu" for everything else. */
export default function BottomNav({ role, onMenu }) {
  const { hasModule } = useTenantConfig();
  const { office } = useAuth();
  const { pathname } = useLocation();
  const { links } = useNav();
  let items = (BOTTOM_NAV[role] || []).filter((i) => hasModule(i.module) && !(i.teaching && office?.teaching === false));
  // Office staff get their own office pages next to Home (gate security gets the visitor desk, and so on)
  if (role === 'employee' && office?.roles?.length) {
    const desk = links.filter((l) => l.to.startsWith('/admin/') && l.to !== '/admin/dashboard').slice(0, 4 - Math.min(items.length, 2))
      .map((l) => ({ label: l.text.split(' ')[0].replace(/&$/, ''), to: l.to, icon: l.icon, also: l.match }));
    items = [items[0], ...desk, ...items.slice(1)].slice(0, 4);
  }
  if (items.length < 2) return null;
  return (
    <nav className="bottomnav" aria-label="Main pages">
      {items.map((i) => {
        const Icon = i.icon;
        const active = [i.to, ...(i.also || [])].some((to) => onPage(pathname, to));
        return (
          <NavLink key={i.to} to={i.to} className={() => `bottomnav__item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon size={20} /><span>{i.label}</span>
          </NavLink>
        );
      })}
      <button type="button" className="bottomnav__item" onClick={onMenu}><Menu size={20} /><span>Menu</span></button>
    </nav>
  );
}

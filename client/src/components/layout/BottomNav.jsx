import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { BOTTOM_NAV } from '../../config/menu.config.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { onPage } from '../../hooks/useNav.js';

/** Phones only: the four pages this role opens most, and "Menu" for everything else. */
export default function BottomNav({ role, onMenu }) {
  const { hasModule } = useTenantConfig();
  const { pathname } = useLocation();
  const items = (BOTTOM_NAV[role] || []).filter((i) => hasModule(i.module));
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

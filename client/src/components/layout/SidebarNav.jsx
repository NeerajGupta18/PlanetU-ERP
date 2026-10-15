import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { onPage } from '../../hooks/useNav.js';

const STORE = 'erp.navgroups';
const readClosed = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };

const Link = ({ item, counts }) => {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const active = (item.match || [item.to]).some((to) => onPage(pathname, to));
  const n = item.badge ? Number(counts?.[item.badge] || 0) : 0;
  return (
    <NavLink to={item.to} className={() => `navlink ${active ? 'is-active' : ''}`} title={item.text} aria-current={active ? 'page' : undefined}>
      <Icon size={18} /><span>{item.text}</span>
      {n > 0 && <b className="navlink__badge" aria-label={`${n} waiting`}>{n > 99 ? '99+' : n}</b>}
    </NavLink>
  );
};

/** Grouped, collapsible sidebar links with a filter box. The group holding the current page is always open. */
export default function SidebarNav({ tree, flat, counts }) {
  const { pathname } = useLocation();
  const [closed, setClosed] = useState(readClosed);
  const [query, setQuery] = useState('');

  const activeGroup = useMemo(() => flat.find((i) => onPage(pathname, i.to))?.group || null, [flat, pathname]);

  // Opening a page inside a collapsed group opens that group again
  useEffect(() => {
    if (activeGroup && closed.includes(activeGroup)) setClosed((c) => c.filter((g) => g !== activeGroup));
    // only when the page changes, not when the user closes the group they are in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  const toggle = (g) => setClosed((c) => {
    const next = c.includes(g) ? c.filter((x) => x !== g) : [...c, g];
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });

  const q = query.trim().toLowerCase();
  const hasGroups = tree.some((e) => e.group);

  return (
    <>
      {hasGroups && (
        <div className="sidebar__search">
          <Search size={14} />
          <input
            type="search" placeholder="Filter menu..." value={query} onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter menu"
          />
        </div>
      )}
      <nav className="sidebar__nav">
        {q ? (
          (() => {
            const hits = flat.filter((i) => `${i.text} ${i.parent || ''} ${i.group || ''}`.toLowerCase().includes(q));
            return hits.length ? hits.map((i) => <Link key={i.to} item={i} counts={counts} />) : <p className="sidebar__none">No menu item matches.</p>;
          })()
        ) : tree.map((entry) => {
          if (!entry.group) return <Link key={entry.to} item={entry} counts={counts} />;
          const open = !closed.includes(entry.group);
          const GIcon = entry.icon;
          return (
            <div key={entry.group} className={`navgroup ${open ? 'is-open' : ''}`}>
              <button type="button" className="navgroup__head" onClick={() => toggle(entry.group)} aria-expanded={open}>
                <GIcon size={16} /><span>{entry.group}</span><ChevronDown size={14} className="navgroup__chev" />
              </button>
              <div className="navgroup__items">{entry.items.map((i) => <Link key={i.to} item={i} counts={counts} />)}</div>
            </div>
          );
        })}
      </nav>
    </>
  );
}

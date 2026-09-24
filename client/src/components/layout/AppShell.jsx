import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, MapPin, Menu, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { MENU, ROLE_LABEL } from '../../config/menu.config.js';
import { useOutsideClick } from '../../hooks/useOutsideClick.js';
import { fmtDate } from '../../utils/dates.js';
import { BRAND } from '../../config/brand.js';
import BrandMark from '../ui/BrandMark.jsx';

function Dropdown({ button, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClick(ref, close);
  return (
    <div className="dropdown" ref={ref}>
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div className={`dropdown__panel dropdown__panel--${align}`} onClick={close}>{children}</div>}
    </div>
  );
}

export default function AppShell() {
  const { user, institute, notifications, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('erp.sidebar') === 'collapsed');
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      setDrawer((o) => !o);
    } else {
      setCollapsed((c) => {
        localStorage.setItem('erp.sidebar', c ? 'expanded' : 'collapsed');
        return !c;
      });
    }
  };

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const menu = MENU[user.role] || [];

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${drawer ? 'is-drawer-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="sidebar__logo"><BrandMark size={26} /></span>
          <span className="sidebar__brand-text">
            <strong>{institute?.shortName || BRAND.short}</strong>
            <small>{ROLE_LABEL[user.role]} Portal</small>
          </span>
        </div>
        <nav className="sidebar__nav">
          {menu.map(({ label, to, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `navlink ${isActive ? 'is-active' : ''}`} title={label}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} />

      <div className="shell__main">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar"><Menu size={20} /></button>
          <div className="topbar__brand">
            <span className="topbar__name">{institute?.name || BRAND.name}</span>
            <span className="topbar__meta">
              {institute?.address || institute?.phone ? (
                <>
                  {institute?.address && <span><MapPin size={12} /> {institute.address}</span>}
                  {institute?.phone && <span><Phone size={12} /> {institute.phone}</span>}
                </>
              ) : (
                <span>{institute?.tagline || BRAND.tagline}</span>
              )}
            </span>
          </div>

          <div className="topbar__right">
            <Dropdown
              button={({ toggle }) => (
                <button type="button" className="icon-btn bell" onClick={toggle} aria-label={`Notifications (${notifications.length})`}>
                  <Bell size={19} />
                  {notifications.length > 0 && <span className="bell__badge">{notifications.length}</span>}
                </button>
              )}
            >
              <div className="notif">
                <div className="notif__head">Notifications</div>
                {notifications.length === 0 && <p className="notif__empty">You're all caught up.</p>}
                {notifications.map((n) => (
                  <div key={n.id} className="notif__item">
                    <strong>{n.title}</strong>
                    <small>{n.category} - {fmtDate(n.date)}</small>
                  </div>
                ))}
              </div>
            </Dropdown>

            <Dropdown
              button={({ toggle }) => (
                <button type="button" className="usermenu" onClick={toggle}>
                  <span className="usermenu__avatar">{user.initials}</span>
                  <span className="usermenu__text">
                    <strong>{user.name}</strong>
                    <small>{ROLE_LABEL[user.role]}</small>
                  </span>
                  <ChevronDown size={14} />
                </button>
              )}
            >
              <div className="menu">
                <div className="menu__who"><strong>{user.name}</strong><small>{user.loginId}</small></div>
                <button type="button" className="menu__item" onClick={onLogout}><LogOut size={15} /> Sign out</button>
              </div>
            </Dropdown>
          </div>
        </header>

        <main className="content"><Outlet /></main>

        <footer className="footer">
          Copyright &copy; {new Date().getFullYear()} {institute?.name}. All rights reserved.
        </footer>
      </div>
    </div>
  );
}

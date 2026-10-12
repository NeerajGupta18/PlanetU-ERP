import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, KeyRound, LogOut, MapPin, Menu, Phone, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { useNav } from '../../hooks/useNav.js';
import { ROLE_LABEL } from '../../config/menu.config.js';
import { useOutsideClick } from '../../hooks/useOutsideClick.js';
import { fmtDate } from '../../utils/dates.js';
import { BRAND } from '../../config/brand.js';
import BrandMark from '../ui/BrandMark.jsx';
import SidebarNav from './SidebarNav.jsx';
import Breadcrumbs from './Breadcrumbs.jsx';
import SearchPalette from './SearchPalette.jsx';

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

const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A slim strip across the admin's screens: an invoice is due or overdue, or the trial is ending. */
function BillingBanner({ b }) {
  const plural = (n) => `${n} day${n === 1 ? '' : 's'}`;
  // Only the message for this kind is built: formatting a date this kind does not have would throw
  let text = '';
  if (b.kind === 'overdue') text = `Invoice ${b.number} (${money(b.total || 0)}) is ${plural(b.daysOverdue)} overdue. Please pay to avoid an interruption.`;
  else if (b.kind === 'due') text = `Invoice ${b.number} (${money(b.total || 0)}) is due ${b.daysLeft === 0 ? 'today' : `in ${plural(b.daysLeft)}`}.`;
  else if (b.kind === 'trial') text = `Your free trial ends ${b.daysLeft === 0 ? 'today' : `in ${plural(b.daysLeft)}`}. Choose a plan to carry on without interruption.`;
  else if (b.kind === 'cancelling') text = `Your subscription ends on ${fmtDate(b.endsOn)}.`;
  else return null;
  return (
    <div className={`billing-banner billing-banner--${b.kind === 'overdue' ? 'overdue' : b.kind === 'cancelling' ? 'info' : 'due'}`} role="status">
      <span>{text}</span>
      <Link to="/admin/billing">{b.kind === 'trial' ? 'Choose a plan' : b.kind === 'cancelling' ? 'Manage' : 'Pay now'}</Link>
    </div>
  );
}

export default function AppShell() {
  const { user, tenant, billing, institute, notifications, logout } = useAuth();
  const { t } = useTenantConfig();
  const { tree, flat } = useNav();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('erp.sidebar') === 'collapsed');
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  // Ctrl+K / Cmd+K opens quick search from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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

  // useNav() already hides switched-off modules, applies the institute's own words and the billing lock
  const locked = Boolean(tenant?.billingLocked);

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${drawer ? 'is-drawer-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="sidebar__logo"><BrandMark size={26} /></span>
          <span className="sidebar__brand-text">
            <strong>{institute?.shortName || BRAND.short}</strong>
            <small>{user.role === 'student' ? `${t('student', 'Student')} Portal` : `${ROLE_LABEL[user.role]} Portal`}</small>
          </span>
        </div>
        <SidebarNav tree={tree} flat={flat} />
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
            <button type="button" className="searchbtn" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl+K)">
              <Search size={16} /><span>Search</span><kbd>Ctrl K</kbd>
            </button>
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
                <button type="button" className="menu__item" onClick={() => navigate('/change-password')}><KeyRound size={15} /> Change password</button>
                <button type="button" className="menu__item" onClick={onLogout}><LogOut size={15} /> Sign out</button>
              </div>
            </Dropdown>
          </div>
        </header>

        <main className="content">
          <Breadcrumbs flat={flat} />
          {user.role === 'admin' && billing && !locked && location.pathname !== '/admin/billing' && <BillingBanner b={billing} />}
          <Outlet />
        </main>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} flat={flat} />

        <footer className="footer">
          Copyright &copy; {new Date().getFullYear()} {institute?.name}. All rights reserved.
        </footer>
      </div>
    </div>
  );
}

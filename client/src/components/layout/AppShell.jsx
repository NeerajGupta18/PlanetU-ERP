import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import ErrorBoundary from '../ui/ErrorBoundary.jsx';
import { Loader } from '../ui/Feedback.jsx';
import { Bell, BookOpenCheck, ChevronDown, Fingerprint, KeyRound, LogOut, MapPin, Menu, Phone, Search } from 'lucide-react';
import { useBell } from '../../hooks/useBell.js';
import BellPanel from './BellPanel.jsx';
import BottomNav from './BottomNav.jsx';
import SectionTabs from './SectionTabs.jsx';
import InstallPrompt from '../campus/InstallPrompt.jsx';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
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
import { startAutoScroll } from '../../lib/autoScroll.js';
import { applyBrandColor, logoUrl } from '../../lib/brandTheme.js';
import { accountKey, fingerprintPossible, isSaved } from '../../lib/fingerprint.js';

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

/** A parent with more than one child picks whose records they are looking at. */
function ChildSwitcher() {
  const { data } = useFetch('/parent/children');
  if (!data || data.children.length < 2) return null;
  const change = async (e) => {
    await api.post('/parent/child', { childId: e.target.value });
    window.location.reload();
  };
  return (
    <label className="child-switch">
      <span>Child</span>
      <select value={data.selected || ''} onChange={change} aria-label="Choose child">
        {data.children.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
    </label>
  );
}

export default function AppShell() {
  const { user, tenant, billing, institute, logout } = useAuth();
  const { t } = useTenantConfig();
  const { tree, flat, links } = useNav();
  const bell = useBell(user.role !== 'super_admin');
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('erp.sidebar') === 'collapsed');
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mainRef = useRef(null);
  useEffect(() => startAutoScroll(mainRef.current), []);
  // The institute's own colour on every screen (back to the PlanetU navy when it has none, or on sign-out)
  const brandColor = user.role === 'super_admin' ? null : institute?.brandColor;
  useEffect(() => { applyBrandColor(brandColor); return () => applyBrandColor(null); }, [brandColor]);

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

  const onLogout = async (forgetKey) => {
    await logout({ forgetKey });
    navigate('/login', { replace: true });
  };
  // Android app with fingerprint on for this account: also offer to sign out and forget this phone
  const fpKey = tenant && fingerprintPossible() ? accountKey(tenant.code, user) : null;
  const fpSaved = Boolean(fpKey && isSaved(fpKey));

  // useNav() already hides switched-off modules, applies the institute's own words and the billing lock
  const locked = Boolean(tenant?.billingLocked);

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${drawer ? 'is-drawer-open' : ''} ${['student', 'parent', 'employee'].includes(user.role) ? 'has-bottomnav' : ''}`}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to main content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="sidebar__logo"><BrandMark size={26} src={logoUrl(institute)} /></span>
          <span className="sidebar__brand-text">
            <strong>{institute?.shortName || BRAND.short}</strong>
            <small>{user.role === 'student' ? `${t('student', 'Student')} Portal` : `${ROLE_LABEL[user.role]} Portal`}</small>
          </span>
        </div>
        <SidebarNav tree={tree} flat={flat} counts={bell.counts} />
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
            {/* The parent home has its own large child chips */}
            {user.role === 'parent' && location.pathname !== '/parent/home' && <ChildSwitcher />}
            <button type="button" className="searchbtn" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl+K)">
              <Search size={16} /><span>Search</span><kbd>Ctrl K</kbd>
            </button>
            <Dropdown
              button={({ toggle }) => (
                <button type="button" className="icon-btn bell" onClick={toggle} aria-label={`Notifications (${bell.total})`}>
                  <Bell size={19} />
                  {bell.total > 0 && <span className="bell__badge">{bell.total > 99 ? '99+' : bell.total}</span>}
                </button>
              )}
            >
              <BellPanel bell={bell} />
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
                <button type="button" className="menu__item" onClick={() => navigate(`/${user.role === 'super_admin' ? 'super-admin' : user.role}/help`)}><BookOpenCheck size={15} /> How to use</button>
                <button type="button" className="menu__item" onClick={() => navigate('/change-password')}><KeyRound size={15} /> Change password</button>
                {user.role !== 'super_admin' && <button type="button" className="menu__item" onClick={() => navigate('/devices')}><Fingerprint size={15} /> Fingerprint and phones</button>}
                <InstallPrompt className="menu__item" />
                <button type="button" className="menu__item" onClick={() => onLogout()}><LogOut size={15} /> Sign out</button>
                {fpSaved && <button type="button" className="menu__item" onClick={() => onLogout(fpKey)}><LogOut size={15} /> Sign out and forget this phone</button>}
              </div>
            </Dropdown>
          </div>
        </header>

        <main className="content" id="main" tabIndex={-1} ref={mainRef}>
          <Breadcrumbs flat={flat} />
          <SectionTabs links={links} />
          {user.role === 'admin' && billing && !locked && location.pathname !== '/admin/billing' && <BillingBanner b={billing} />}
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Loader label="Opening the page..." />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} flat={flat} />
        <BottomNav role={user.role} onMenu={() => setDrawer(true)} />

        <footer className="footer">
          Copyright &copy; {new Date().getFullYear()} {institute?.name}. All rights reserved.
        </footer>
      </div>
    </div>
  );
}

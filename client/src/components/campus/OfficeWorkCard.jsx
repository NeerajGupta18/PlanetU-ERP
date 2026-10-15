import { Link } from 'react-router-dom';
import {
  AlertTriangle, Award, Banknote, BedDouble, BookOpen, Briefcase, Bus, CalendarDays, CalendarOff, ChevronRight, ClipboardCheck, ClipboardList, DoorOpen,
  GraduationCap, Inbox, LayoutDashboard, Library, Network, PenLine, Percent, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useNav } from '../../hooks/useNav.js';
import { Badge, Card, StatCard } from '../ui/Ui.jsx';

const CARD_ICON = {
  banknote: Banknote, trend: TrendingUp, wallet: Wallet, alert: AlertTriangle, users: Users, percent: Percent, calendar: CalendarDays, away: CalendarOff,
  award: Award, clipboard: ClipboardList, userplus: UserPlus, pen: PenLine, book: BookOpen, bed: BedDouble, bus: Bus, door: DoorOpen, briefcase: Briefcase,
};
const GROUP_ICON = {
  fees: Wallet, payroll: Banknote, department: Network, admissions: ClipboardCheck, certificates: Award, exams: GraduationCap,
  library: Library, hostel: BedDouble, transport: Bus, visitors: DoorOpen, placement: Briefcase,
};

/**
 * For an employee with staff roles: the numbers for each office desk they run (fees, the library, the gate, their
 * department...) with the status of each, then shortcuts to every office page they cover. A principal, who sees
 * the whole institute, gets a link to the institute overview instead.
 */
export default function OfficeWorkCard() {
  const { office } = useAuth();
  const { links } = useNav();
  const { data } = useFetch(office?.roles?.length ? '/employee/office-summary' : null);
  if (!office?.roles?.length) return null;
  const pages = links.filter((l) => l.to.startsWith('/admin/') && l.to !== '/admin/dashboard');
  const roles = <div className="badges">{office.roles.map((r) => <Badge key={r.role} tone="purple">{r.label}{r.department ? `: ${r.department}` : ''}</Badge>)}</div>;

  return (
    <>
      {data?.overview && (
        <Card title="Institute overview" icon={LayoutDashboard} action={roles}>
          <div className="overview-link">
            <p style={{ margin: 0 }}>Attendance, fees, approvals and everything waiting across the institute, on one page.</p>
            <div className="badges" style={{ gap: 8 }}>
              {data.approvals > 0 && <Link to="/admin/approvals" className="btn btn--outline btn--sm"><Inbox size={14} /> {data.approvals} waiting for approval</Link>}
              <Link to="/admin/dashboard" className="btn btn--primary btn--sm">Open institute overview</Link>
            </div>
          </div>
        </Card>
      )}
      {data?.groups.map((g) => {
        const Icon = GROUP_ICON[g.area] || Briefcase;
        return (
          <section key={g.area} className="kpi-group" aria-label={g.title}>
            <div className="kpi-group__head">
              <h2><Icon size={17} /> {g.title}</h2>
              <Link to={g.link} className="btn btn--outline btn--sm">Open</Link>
            </div>
            <div className={`stats ${g.cards.length === 4 ? '' : 'stats--3'}`}>
              {g.cards.map((c) => <StatCard key={c.key} value={c.value} label={c.label} icon={CARD_ICON[c.icon]} status={c.status || 'neutral'} hint={c.hint} to={c.to} />)}
            </div>
          </section>
        );
      })}
      {!data?.overview && (
        <Card title="Your office work" icon={Briefcase} action={roles}>
          <div className="quicks">
            {pages.map((p) => {
              const PIcon = p.icon;
              return <Link key={p.to} to={p.to} className="quick"><span className="quick__icon"><PIcon size={18} /></span><span>{p.text}</span><ChevronRight size={14} style={{ marginLeft: 'auto' }} /></Link>;
            })}
          </div>
        </Card>
      )}
    </>
  );
}

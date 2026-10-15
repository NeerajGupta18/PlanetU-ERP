import { Link } from 'react-router-dom';
import { Briefcase, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNav } from '../../hooks/useNav.js';
import { Badge, Card } from '../ui/Ui.jsx';

/** For an employee with staff roles: which roles they hold and a shortcut to each office page they cover. */
export default function OfficeWorkCard() {
  const { office } = useAuth();
  const { links } = useNav();
  if (!office?.roles?.length) return null;
  const pages = links.filter((l) => l.to.startsWith('/admin/'));
  return (
    <Card title="Your office work" icon={Briefcase} action={<div className="badges">{office.roles.map((r) => <Badge key={r.role} tone="purple">{r.label}{r.department ? `: ${r.department}` : ''}</Badge>)}</div>}>
      <div className="quicks">
        {pages.map((p) => {
          const Icon = p.icon;
          return <Link key={p.to} to={p.to} className="quick"><span className="quick__icon"><Icon size={18} /></span><span>{p.text}</span><ChevronRight size={14} style={{ marginLeft: 'auto' }} /></Link>;
        })}
      </div>
    </Card>
  );
}

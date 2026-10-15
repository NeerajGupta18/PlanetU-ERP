import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, LifeBuoy, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Card, PageBanner } from '../../components/ui/Ui.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { guidesFor } from '../../config/helpGuide.js';

const SUPPORT = { employee: '/employee/support', student: '/student/support', parent: '/parent/support' };

/** "How to use": short step-by-step guides for the tasks this person does, with a link to each page. */
export default function Help() {
  const { user, office } = useAuth();
  const { hasModule } = useTenantConfig();
  const [q, setQ] = useState('');
  const all = useMemo(() => guidesFor(user, office, hasModule), [user, office, hasModule]);
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter((g) => `${g.title} ${g.steps.join(' ')}`.toLowerCase().includes(needle)) : all;

  return (
    <>
      <PageBanner icon={BookOpenCheck} title="How to use" subtitle="Short steps for the things you do most" />
      <Card>
        <div className="input-wrap" style={{ maxWidth: 420, marginBottom: 14 }}>
          <Search size={14} />
          <input className="input input--icon" placeholder="Search, for example leave or fees" aria-label="Search the guide" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.length === 0 ? (
          <EmptyState title="Nothing matches" hint="Try another word, or ask the office using Help and feedback." />
        ) : (
          <div className="guide">
            {list.map((g, i) => (
              <details key={g.id} className="guide__item" open={Boolean(needle) || i === 0}>
                <summary>{g.title}</summary>
                <ol>{g.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {g.to && <Link to={g.to} className="btn btn--outline btn--sm">Go there <ArrowRight size={13} /></Link>}
              </details>
            ))}
          </div>
        )}
      </Card>
      {SUPPORT[user.role] && hasModule('grievance') && (
        <Card>
          <div className="overview-link">
            <p style={{ margin: 0 }}><LifeBuoy size={16} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--brand)' }} />Still stuck? Send a question to the institute office.</p>
            <Link to={SUPPORT[user.role]} className="btn btn--primary btn--sm">Help and feedback</Link>
          </div>
        </Card>
      )}
    </>
  );
}

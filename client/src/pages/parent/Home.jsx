import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ParentHome() {
  const { user } = useAuth();
  const { hasModule } = useTenantConfig();
  const { data, loading, error, reload } = useFetch('/parent/children');

  const open = async (id, to) => {
    await api.post('/parent/child', { childId: id });
    window.location.assign(to);
  };

  return (
    <>
      <PageBanner icon={Users} title={`Welcome, ${user.name}`} subtitle="Your children's attendance, results and fees in one place" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.children.length === 0 ? (
          <EmptyState title="No children linked" hint="Please contact the institute office to link your child to this account." />
        ) : (
          <div className="child-cards">
            {data.children.map((k) => (
              <div key={k.id} className={`child-card ${k.id === data.selected ? 'is-selected' : ''}`}>
                <h3>{k.name}</h3>
                <div className="muted">{k.course} - Sem {k.semester}{k.section ? ` / ${k.section}` : ''} - {k.studentCode}</div>
                <div style={{ marginTop: 6 }}><Badge tone="blue">{k.relation}</Badge></div>
                <div className="child-card__stats">
                  {k.attendance && (
                    <div><strong style={{ color: k.attendance.overall < k.attendance.threshold ? 'var(--danger, #b91c1c)' : undefined }}>{k.attendance.overall ?? '-'}{k.attendance.overall != null && '%'}</strong><span className="muted">Attendance</span></div>
                  )}
                  {k.outstanding != null && (
                    <div><strong>{inr(k.outstanding)}</strong><span className="muted">Fees due</span></div>
                  )}
                </div>
                <div className="child-card__links">
                  {hasModule('attendance') && <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/attendance')}>Attendance</button>}
                  {hasModule('exams') && <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/results')}>Results</button>}
                  {hasModule('fees') && <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/fees')}>Fees</button>}
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/profile')}>Profile</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </DataBoundary>
    </>
  );
}

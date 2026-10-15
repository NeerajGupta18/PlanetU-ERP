import { Link } from 'react-router-dom';
import { CalendarOff, ClipboardCheck, FileText, Inbox, LifeBuoy } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';

const KIND = {
  leave: { label: 'Leave', icon: CalendarOff },
  certificate: { label: 'Certificate', icon: FileText },
  application: { label: 'Application', icon: ClipboardCheck },
  grievance: { label: 'Ticket', icon: LifeBuoy },
};
const waited = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
};

/** Everything waiting for the office's decision, oldest first. Leave can be decided here; the rest opens its page. */
export default function Approvals() {
  const { data, loading, error, reload } = useFetch('/admin/approvals');
  const [tab, setTab] = useTabParam('all');
  const { prompt, toast } = useDialogs();
  const c = data?.counts || {};
  const tabs = [{ id: 'all', label: `All (${c.approvals ?? 0})` },
    ...Object.entries(KIND).filter(([k]) => c[k] !== undefined).map(([k, v]) => ({ id: k, label: `${v.label} (${c[k]})` }))];
  const items = (data?.items || []).filter((i) => tab === 'all' || i.type === tab);

  const decideLeave = async (i, decision) => {
    let remark = '';
    if (decision === 'reject') {
      remark = await prompt(`Why is ${i.who}'s leave not approved? They will see this.`, { required: true, title: 'Not approving', confirmLabel: 'Send', danger: true });
      if (!remark) return;
    }
    try { await api.put(`/admin/leave/${i.id}`, { decision, remark }); toast.success(decision === 'approve' ? 'Leave approved.' : 'Leave not approved.'); reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner icon={Inbox} title="Approvals" subtitle="Everything waiting for your decision, oldest first." />
      <Card>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (items.length === 0 ? <EmptyState title="Nothing is waiting" hint="New leave requests, certificate requests, applications and tickets will appear here." /> : (
            <div>
              {items.map((i) => {
                const K = KIND[i.type];
                return (
                  <div key={`${i.type}-${i.id}`} className="approval">
                    <span className="approval__icon" aria-hidden="true"><K.icon size={18} /></span>
                    <div className="approval__main">
                      <div><Badge tone="amber">{K.label}</Badge> <strong>{i.title}</strong></div>
                      <span>{i.who}{i.detail ? ` - ${i.type === 'leave' ? leaveDates(i.detail) : i.detail}` : ''}</span>
                      {i.note && <small>{i.note}</small>}
                      <small>Waiting since {waited(i.since)}</small>
                    </div>
                    <div className="approval__actions">
                      {i.type === 'leave' ? (
                        <>
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => decideLeave(i, 'approve')}>Approve</button>
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => decideLeave(i, 'reject')}>Reject</button>
                        </>
                      ) : <Link className="btn btn--outline btn--sm" to={i.link}>{i.type === 'certificate' ? 'Issue or reject' : i.type === 'application' ? 'Review' : 'Answer'}</Link>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </DataBoundary>
      </Card>
    </>
  );
}

function leaveDates(detail) {
  const [a, b] = String(detail).split(' to ');
  return b ? `${fmtDate(a)} to ${fmtDate(b)}` : fmtDate(a);
}

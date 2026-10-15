import { useState } from 'react';
import { CheckCheck, Megaphone, Pin } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';

/** Read-only notice board for students and staff. `base` is '/student' or '/employee'. */
export default function NoticeBoard({ base }) {
  const { toast } = useDialogs();
  const { data, loading, error, reload } = useFetch(`${base}/notices`);
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(() => new Set());

  const notices = (data?.notices || []).filter((n) => !category || n.category === category);
  const used = [...new Set((data?.notices || []).map((n) => n.category))];

  const toggle = async (n) => {
    const next = new Set(open);
    if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
    setOpen(next);
    if (!n.read) {
      try { await api.post(`${base}/notices/${n.id}/read`); reload(); } catch { /* reading is best effort */ }
    }
  };
  const readAll = async () => {
    try { await api.post(`${base}/notices/read-all`); reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={Megaphone} title="Notice board" subtitle={data ? (data.unread ? `${data.unread} new` : 'You are up to date') : 'Announcements from your institute'}
        actions={data?.unread > 0 && <button type="button" className="btn btn--outline btn--sm" onClick={readAll}><CheckCheck size={14} /> Mark all as read</button>}
      />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            {used.length > 1 && (
              <div className="chips" role="group" aria-label="Filter by category" style={{ marginBottom: 12 }}>
                <button type="button" className={`chip ${category === '' ? 'is-active' : ''}`} onClick={() => setCategory('')}>All</button>
                {used.map((c) => <button key={c} type="button" className={`chip ${category === c ? 'is-active' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}
              </div>
            )}
            {notices.length === 0 ? <Card><EmptyState title="No notices" hint="New announcements will appear here." /></Card> : (
              <div style={{ display: 'grid', gap: 12 }}>
                {notices.map((n) => (
                  <article key={n.id} className={`notice-card ${n.priority === 'important' ? 'is-important' : ''} ${n.read ? '' : 'is-new'}`}>
                    <div className="notice-card__head">
                      <h3>{!n.read && <span className="dot-new" role="img" aria-label="New" />}{n.title}</h3>
                      <div className="notice-card__meta">
                        {n.pinned && <Badge tone="gray"><Pin size={11} /> Pinned</Badge>}
                        {n.priority === 'important' && <Badge tone="red">Important</Badge>}
                        <Badge tone="blue">{n.category}</Badge>
                        <span>{fmtDate(n.date)}</span>
                      </div>
                    </div>
                    {n.course && <div className="notice-card__meta">For {n.course}</div>}
                    {n.body && <p className={`notice-card__body ${open.has(n.id) ? '' : 'notice-card__body--clamp'}`}>{n.body}</p>}
                    {(n.body.length > 140 || !n.read) && (
                      <button type="button" className="btn btn--outline btn--sm" style={{ marginTop: 10 }} onClick={() => toggle(n)}>{open.has(n.id) ? 'Show less' : 'Read'}</button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </DataBoundary>
    </>
  );
}

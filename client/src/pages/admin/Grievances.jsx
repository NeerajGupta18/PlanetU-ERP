import { useState } from 'react';
import { LifeBuoy, Search } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import Thread, { STATUS_TONE, STATUS_WORD } from '../../components/grievance/Thread.jsx';
import { fmtDate } from '../../utils/dates.js';

const TABS = [{ id: 'active', label: 'Active' }, { id: 'resolved', label: 'Resolved' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }];

function Detail({ id, onClose, onChanged }) {
  const { toast } = useDialogs();
  const t = useFetch(`/admin/grievances/${id}`);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const g = t.data?.grievance;
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post(`/admin/grievances/${id}/reply`, { body: text, status: status || undefined }); setText(''); setStatus(''); t.reload(); onChanged(); } catch (x) { toast.error(x); } finally { setBusy(false); }
  };
  return (
    <Modal open title={g ? `${g.ticketNo} - ${g.subject}` : 'Ticket'} onClose={onClose} width={680}>
      <DataBoundary loading={t.loading} error={t.error} data={t.data} reload={t.reload}>
        {g && (
          <>
            <p style={{ marginTop: 0 }}>
              <Badge tone={STATUS_TONE[g.status]}>{STATUS_WORD[g.status]}</Badge> <Badge tone="blue">{g.category}</Badge> From <strong>{g.from}</strong>
              {g.studentCode && <span className="muted"> ({g.studentCode})</span>}
            </p>
            {g.anonymous && <p className="muted">The person chose to hide their name. You can still reply and they will see it.</p>}
            <Thread grievance={g} messages={t.data.messages} mineIsOffice firstFrom={g.anonymous ? 'Anonymous' : g.from} />
            <form onSubmit={send} style={{ marginTop: 12 }}>
              <textarea className="input" rows={3} maxLength={3000} placeholder={g.status === 'closed' ? 'Re-open the ticket to reply' : 'Write a reply'} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="form-actions">
                <select className="input" style={{ maxWidth: 190 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Set status">
                  <option value="">Keep status</option>{Object.entries(STATUS_WORD).map(([k, v]) => <option key={k} value={k}>Set to {v.toLowerCase()}</option>)}
                </select>
                <button className="btn btn--primary" disabled={busy || (!text.trim() && !status)}>{text.trim() ? 'Send reply' : 'Update status'}</button>
              </div>
            </form>
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

export default function Grievances() {
  const [tab, setTab] = useTabParam('active', TABS.map((t) => t.id));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(null);
  const qs = new URLSearchParams();
  if (tab !== 'all') qs.set('status', tab);
  if (category) qs.set('category', category);
  if (search) qs.set('search', search);
  const list = useFetch(`/admin/grievances?${qs}`);
  const counts = list.data?.counts || {};
  const active = (counts.open || 0) + (counts.in_progress || 0);

  return (
    <>
      <PageBanner icon={LifeBuoy} title="Grievances" subtitle="Tickets raised by students, parents and staff" />
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.id === 'active' && active ? `Active (${active})` : t.label }))} active={tab} onChange={setTab} />
      <Card>
        <div className="toolbar">
          <div className="toolbar__filters">
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(list.data?.categories || []).map((c) => <option key={c}>{c}</option>)}</select>
            <div className="input-wrap" style={{ minWidth: 220 }}><Search size={14} /><input className="input input--icon" placeholder="Ticket, subject or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
        </div>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.grievances.length === 0 ? <EmptyState title="No tickets here" hint="Nothing matches this list." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Ticket</th><th>From</th><th>Category</th><th>Updated</th><th>Replies</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data.grievances.map((g) => (
                    <tr key={g.id}>
                      <td><strong>{g.subject}</strong><div className="muted">{g.ticketNo}</div></td>
                      <td>{g.from}{g.raiserRole && <div className="muted">{g.raiserRole}</div>}</td><td>{g.category}</td>
                      <td className="muted">{fmtDate(String(g.updatedAt).slice(0, 10))}</td><td>{g.replies}</td>
                      <td><Badge tone={STATUS_TONE[g.status]}>{STATUS_WORD[g.status]}</Badge></td>
                      <td><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(g.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

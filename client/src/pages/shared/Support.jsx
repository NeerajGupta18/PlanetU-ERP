import { useState } from 'react';
import { LifeBuoy, MessageSquarePlus, Star } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import Thread, { STATUS_TONE, STATUS_WORD } from '../../components/grievance/Thread.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { fmtDate } from '../../utils/dates.js';

function RaiseModal({ base, categories, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [f, setF] = useState({ category: '', subject: '', details: '', anonymous: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.post(`${base}/grievances`, f); toast.success(`Ticket ${r.grievance.ticketNo} raised.`); onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Raise a ticket" onClose={onClose} width={560}>
      <form onSubmit={save}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <label className="form-field"><span className="label">Category *</span>
            <select className="input" value={f.category} onChange={set('category')} required><option value="">Select...</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="form-field form-field--full"><span className="label">Subject *</span><input className="input" maxLength={150} value={f.subject} onChange={set('subject')} required /></label>
          <label className="form-field form-field--full"><span className="label">What happened? *</span><textarea className="input" rows={5} maxLength={3000} value={f.details} onChange={set('details')} required /></label>
          <div className="form-field form-field--full"><label><input type="checkbox" checked={f.anonymous} onChange={(e) => setF((x) => ({ ...x, anonymous: e.target.checked }))} /> Hide my name from the office</label>
            <p className="muted" style={{ margin: '4px 0 0' }}>You can still see replies here. The office cannot see who you are.</p></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Sending...' : 'Raise ticket'}</button></div>
      </form>
    </Modal>
  );
}

function TicketModal({ base, id, onClose, onChanged }) {
  const { confirm, toast } = useDialogs();
  const t = useFetch(`${base}/grievances/${id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const g = t.data?.grievance;
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post(`${base}/grievances/${id}/reply`, { body: text }); setText(''); t.reload(); onChanged(); } catch (x) { toast.error(x); } finally { setBusy(false); }
  };
  const close = async () => {
    if (!(await confirm('Close this ticket? Do this when your problem is sorted out.', { confirmLabel: 'Close ticket' }))) return;
    try { await api.post(`${base}/grievances/${id}/close`); t.reload(); onChanged(); } catch (x) { toast.error(x); }
  };
  return (
    <Modal open title={g ? `${g.ticketNo} - ${g.subject}` : 'Ticket'} onClose={onClose} width={640}>
      <DataBoundary loading={t.loading} error={t.error} data={t.data} reload={t.reload}>
        {g && (
          <>
            <p style={{ marginTop: 0 }}><Badge tone={STATUS_TONE[g.status]}>{STATUS_WORD[g.status]}</Badge> <Badge tone="blue">{g.category}</Badge>{g.anonymous && <> <Badge tone="gray">Name hidden</Badge></>}</p>
            <Thread grievance={g} messages={t.data.messages} firstFrom="You" />
            {g.status === 'closed' ? <p className="muted">This ticket is closed.</p> : (
              <form onSubmit={send} style={{ marginTop: 12 }}>
                <textarea className="input" rows={3} maxLength={3000} placeholder="Write a reply" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="form-actions">
                  <button type="button" className="btn btn--outline" onClick={close}>Close ticket</button>
                  <button className="btn btn--primary" disabled={busy || !text.trim()}>Send reply</button>
                </div>
              </form>
            )}
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

function Grievances({ base }) {
  const list = useFetch(`${base}/grievances`);
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState(null);
  return (
    <Card title="My tickets" action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setRaising(true)}><MessageSquarePlus size={14} /> Raise a ticket</button>}>
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.grievances.length === 0 ? <EmptyState title="No tickets yet" hint="Raise a ticket for any problem and follow the replies here." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Ticket</th><th>Category</th><th>Updated</th><th>Replies</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.data.grievances.map((g) => (
                  <tr key={g.id}>
                    <td><strong>{g.subject}</strong><div className="muted">{g.ticketNo}</div></td><td>{g.category}</td>
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
      {raising && <RaiseModal base={base} categories={list.data?.categories || []} onClose={() => setRaising(false)} onSaved={() => { setRaising(false); list.reload(); }} />}
      {open && <TicketModal base={base} id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </Card>
  );
}

export function RatingInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }} role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} className={`chip ${value === n ? 'is-active' : ''}`} style={{ minWidth: 40 }} onClick={() => onChange(value === n ? null : n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

function FormModal({ base, id, onClose, onDone }) {
  const { toast } = useDialogs();
  const f = useFetch(`${base}/feedback/${id}`);
  const [ans, setAns] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post(`${base}/feedback/${id}`, { answers: f.data.questions.map((q) => ({ questionId: q.id, rating: ans[q.id]?.rating ?? null, comment: ans[q.id]?.comment || '' })) });
      toast.success('Thank you for your feedback.'); onDone();
    } catch (x) { toast.error(x); } finally { setBusy(false); }
  };
  const set = (qid, k, v) => setAns((a) => ({ ...a, [qid]: { ...a[qid], [k]: v } }));
  return (
    <Modal open title={f.data?.form.title || 'Feedback'} onClose={onClose} width={620}>
      <DataBoundary loading={f.loading} error={f.error} data={f.data} reload={f.reload}>
        {f.data && (
          f.data.form.done ? <p>You have already answered this form. Thank you!</p> : (
            <form onSubmit={submit}>
              {f.data.form.description && <p className="muted" style={{ marginTop: 0 }}>{f.data.form.description}</p>}
              <p className="muted">Your answers are anonymous. The office cannot see who wrote what.</p>
              <div style={{ display: 'grid', gap: 14 }}>
                {f.data.questions.map((q) => (
                  <div key={q.id}>
                    <label className="label">{q.text}{q.required && ' *'}</label>
                    {q.kind === 'rating'
                      ? <RatingInput value={ans[q.id]?.rating ?? null} onChange={(v) => set(q.id, 'rating', v)} />
                      : <textarea className="input" rows={3} maxLength={1000} value={ans[q.id]?.comment || ''} onChange={(e) => set(q.id, 'comment', e.target.value)} />}
                  </div>
                ))}
              </div>
              <p className="muted">1 is the lowest rating and 5 is the highest.</p>
              <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Sending...' : 'Submit feedback'}</button></div>
            </form>
          )
        )}
      </DataBoundary>
    </Modal>
  );
}

function Feedback({ base }) {
  const list = useFetch(`${base}/feedback`);
  const [open, setOpen] = useState(null);
  return (
    <Card title="Feedback forms">
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.forms.length === 0 ? <EmptyState title="No feedback forms open" hint="When the office opens a form, it appears here." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Form</th><th>Closes</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.data.forms.map((x) => (
                  <tr key={x.id}>
                    <td><strong>{x.title}</strong>{x.aboutName && <div className="muted">About {x.aboutName}</div>}{x.course && <div className="muted">{x.course}</div>}</td>
                    <td className="muted">{x.closesOn ? fmtDate(x.closesOn) : 'No last date'}</td>
                    <td>{x.done ? <Badge tone="green">Done</Badge> : <Badge tone="amber">To do</Badge>}</td>
                    <td>{!x.done && <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(x.id)}><Star size={13} /> Give feedback</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {open && <FormModal base={base} id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); list.reload(); }} />}
    </Card>
  );
}

/** Help and feedback for students, parents (grievances only) and staff. `base` is '/student' or '/employee'. */
export default function Support({ base }) {
  const { hasModule } = useTenantConfig();
  const tabs = [{ id: 'grievances', label: 'Tickets' }, ...(base === '/parent' ? [] : [{ id: 'feedback', label: 'Feedback' }])];
  const [tab, setTab] = useTabParam('grievances', tabs.map((t) => t.id));
  return (
    <>
      <PageBanner icon={LifeBuoy} title="Help and feedback" subtitle="Raise a problem with the office, or tell us how we are doing" />
      {hasModule('grievance') && (
        <>
          {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
          {tab === 'grievances' && <Grievances base={base === '/parent' ? '/student' : base} />}
          {tab === 'feedback' && <Feedback base={base} />}
        </>
      )}
    </>
  );
}

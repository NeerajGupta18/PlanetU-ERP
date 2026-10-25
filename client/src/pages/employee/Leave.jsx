import { useState } from 'react';
import { CalendarOff, Plus } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate, todayISO } from '../../utils/dates.js';

export const LEAVE_TONE = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' };
export const LEAVE_WORD = { pending: 'Waiting', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };
export const range = (r) => (r.fromDate === r.toDate ? fmtDate(r.fromDate) : `${fmtDate(r.fromDate)} to ${fmtDate(r.toDate)}`);
export const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;

export function ApplyModal({ types, onClose, onSaved, employee }) {
  const { toast } = useDialogs();
  const [f, setF] = useState({ typeId: types[0]?.id || '', fromDate: todayISO(), toDate: todayISO(), halfDay: false, reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const body = { ...f, toDate: f.halfDay ? f.fromDate : f.toDate };
      if (employee) await api.post('/admin/leave', { ...body, employeeId: employee });
      else await api.post('/employee/leave', body);
      toast.success(employee ? 'Leave recorded as approved.' : 'Leave request sent.');
      onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal open title={employee ? 'Record leave' : 'Apply for leave'} onClose={onClose} width={520}>
      <form onSubmit={save}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <label className="form-field form-field--full"><span className="label">Leave type *</span>
            <select className="input" value={f.typeId} onChange={set('typeId')} required>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="form-field"><span className="label">From *</span><input className="input" type="date" value={f.fromDate} onChange={(e) => setF((x) => ({ ...x, fromDate: e.target.value, toDate: x.toDate < e.target.value ? e.target.value : x.toDate }))} required /></label>
          <label className="form-field"><span className="label">To *</span><input className="input" type="date" min={f.fromDate} value={f.halfDay ? f.fromDate : f.toDate} disabled={f.halfDay} onChange={set('toDate')} required /></label>
          <div className="form-field form-field--full"><label><input type="checkbox" checked={f.halfDay} onChange={(e) => setF((x) => ({ ...x, halfDay: e.target.checked }))} /> Half day (one date only)</label></div>
          <label className="form-field form-field--full"><span className="label">Reason {employee ? '' : '*'}</span><textarea className="input" rows={3} maxLength={500} value={f.reason} onChange={set('reason')} required={!employee} /></label>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Sundays and holidays on the calendar are not counted.</p>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : employee ? 'Record' : 'Send request'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Leave() {
  const { confirm, toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/employee/leave');
  const [applying, setApplying] = useState(false);

  const cancel = async (r) => {
    if (!(await confirm(`Cancel your ${r.typeName} leave for ${range(r)}?`, { confirmLabel: 'Cancel leave', danger: true }))) return;
    try { await api.post(`/employee/leave/${r.id}/cancel`); reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={CalendarOff} title="Leave" subtitle={data ? `Balance for ${data.year}` : 'Apply for leave and see its status'}
        actions={<button type="button" className="btn btn--primary" onClick={() => setApplying(true)} disabled={!data?.types.length}><Plus size={15} /> Apply for leave</button>}
      />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            {data.balances.length === 0 ? <Card><EmptyState title="No leave types yet" hint="The office has not set up leave types." /></Card> : (
              <div className="cert-types">
                {data.balances.map((b) => (
                  <div key={b.typeId} className="cert-type">
                    <h3>{b.name}</h3>
                    <div style={{ fontSize: 26, fontWeight: 700 }}>{b.left === null ? 'No limit' : dayWord(b.left)}{b.left !== null && <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> left</span>}</div>
                    <p>{b.allowance === null ? '' : `${b.allowance} a year. `}Taken {b.used}{b.pending > 0 ? `, waiting ${b.pending}` : ''}.</p>
                  </div>
                ))}
              </div>
            )}
            <Card title="My requests">
              {data.requests.length === 0 ? <EmptyState title="No leave requests yet" hint={data.types.length ? "Tap Apply for leave above to send your first request. The office's decisions appear here." : "Your requests and the office's decisions appear here."} /> : (
                <div className="table-wrap">
                  <table className="table table--stack">
                    <thead><tr><th>Leave</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={r.id}>
                          <td><strong>{r.typeName}</strong>{r.halfDay && <div className="muted">Half day</div>}</td>
                          <td>{range(r)}</td>
                          <td>{r.days}</td>
                          <td>{r.reason || '-'}{r.remark && <div className="muted">Office: {r.remark}</div>}</td>
                          <td><Badge tone={LEAVE_TONE[r.status]}>{LEAVE_WORD[r.status]}</Badge></td>
                          <td>{(r.status === 'pending' || (r.status === 'approved' && r.fromDate >= todayISO())) && <button type="button" className="btn btn--outline btn--sm" onClick={() => cancel(r)}>Cancel</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </DataBoundary>
      {applying && <ApplyModal types={data.types} onClose={() => setApplying(false)} onSaved={() => { setApplying(false); reload(); }} />}
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, FileBarChart2, FileText, Plus, Receipt, Search, Trash2, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_TONE = { unpaid: 'red', partial: 'amber', paid: 'green', waived: 'gray' };
const METHODS = [['cash', 'Cash'], ['cheque', 'Cheque'], ['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['card', 'Card'], ['online', 'Online']];

export default function Fees() {
  const { t } = useTenantConfig();
  const [tab, setTab] = useState('students');
  const [newStructure, setNewStructure] = useState(false);
  const structures = useFetch('/admin/fees/structures');

  return (
    <>
      <PageBanner
        icon={Wallet} title="Fees & Payments" subtitle={`Fee plans, charges and payments for ${t('students', 'students').toLowerCase()}`}
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/admin/reports?report=fee-collection" className="btn btn--outline btn--sm" style={{ background: '#fff' }}><FileBarChart2 size={14} /> Collection report</Link>
            <Link to="/admin/reports?report=fee-dues" className="btn btn--outline btn--sm" style={{ background: '#fff' }}><FileBarChart2 size={14} /> Outstanding fees</Link>
          </div>
        )}
      />
      <Card>
        <Tabs tabs={[{ id: 'students', label: 'Student ledger' }, { id: 'structures', label: 'Fee structures' }, { id: 'payments', label: 'All payments' }, { id: 'online', label: 'Online payments' }]} active={tab} onChange={setTab} />
        {tab === 'students' && <StudentLedger />}
        {tab === 'structures' && (
          <>
            <div className="toolbar"><span /><button type="button" className="btn btn--primary btn--sm" onClick={() => setNewStructure(true)}><Plus size={13} /> New structure</button></div>
            <DataBoundary loading={structures.loading} error={structures.error} data={structures.data} reload={structures.reload}>
              {structures.data && (structures.data.structures.length === 0 ? <EmptyState title="No fee structures yet" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Name</th><th>{t('course', 'Course')}</th><th>Year</th><th>Total</th><th>Assigned</th><th /></tr></thead>
                    <tbody>
                      {structures.data.structures.map((s) => <StructureRow key={s.id} s={s} onChanged={structures.reload} />)}
                    </tbody>
                  </table>
                </div>
              ))}
            </DataBoundary>
          </>
        )}
        {tab === 'payments' && <AllPayments />}
        {tab === 'online' && <OnlinePayments />}
      </Card>
      {newStructure && <NewStructureModal onClose={() => setNewStructure(false)} onCreated={() => { setNewStructure(false); structures.reload(); }} />}
    </>
  );
}

function StructureRow({ s, onChanged }) {
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bulkAssign = async () => {
    if (!confirm(`Assign "${s.name}" to every active, unassigned student of ${s.course}?`)) return;
    setBusy(true); setErr('');
    try { const r = await api.post(`/admin/fees/structures/${s.id}/bulk-assign`); alert(`Assigned to ${r.studentsAssigned} student(s).`); onChanged(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete "${s.name}"?`)) return;
    try { await api.del(`/admin/fees/structures/${s.id}`); onChanged(); } catch (e) { alert(e.message); }
  };

  return (
    <>
      <tr>
        <td><strong>{s.name}</strong>{err && <div className="form-error" style={{ margin: 0 }}>{err}</div>}</td>
        <td>{s.course}</td><td>{s.academicYear}</td><td>{inr(s.total)}</td><td>{s.assignedCount}</td>
        <td>
          <div className="row-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setAssigning(true)}>Assign to student</button>
            <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={bulkAssign}>Bulk assign</button>
            {s.assignedCount === 0 && <button type="button" className="btn btn--outline btn--sm" onClick={remove}><Trash2 size={13} /></button>}
          </div>
        </td>
      </tr>
      {assigning && <AssignModal structure={s} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); onChanged(); }} />}
    </>
  );
}

function AssignModal({ structure, onClose, onDone }) {
  const list = useFetch(`/admin/students?courseId=${structure.courseId}&status=Active`);
  const [studentId, setStudentId] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post(`/admin/fees/structures/${structure.id}/assign`, { studentId }); onDone(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <Modal open title={`Assign "${structure.name}"`} onClose={onClose} width={420}>
      <form onSubmit={submit}>
        {err && <p className="form-error">{err}</p>}
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (
            <select className="input" required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Choose a student...</option>
              {list.data.students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.studentCode})</option>)}
            </select>
          )}
        </DataBoundary>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary">Assign</button></div>
      </form>
    </Modal>
  );
}

function NewStructureModal({ onClose, onCreated }) {
  const filters = useFetch('/admin/timetable/filters');
  const [form, setForm] = useState({ name: '', courseId: '', academicYear: '' });
  const [items, setItems] = useState([{ label: '', amount: '', dueDate: '' }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const setItem = (i, k, v) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api.post('/admin/fees/structures', { ...form, items: items.filter((i) => i.label && i.amount).map((i) => ({ ...i, amount: Number(i.amount) })) });
      onCreated();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title="New fee structure" onClose={onClose} width={620}>
      <form onSubmit={submit}>
        {err && <p className="form-error">{err}</p>}
        <DataBoundary loading={filters.loading} error={filters.error} data={filters.data} reload={filters.reload}>
          {filters.data && (
            <div className="fields">
              <div className="form-field"><label className="label" htmlFor="fs-name">Name</label><input id="fs-name" className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. BCA Year 1" /></div>
              <div className="form-field"><label className="label" htmlFor="fs-year">Academic year</label><input id="fs-year" className="input" required value={form.academicYear} onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))} placeholder="2026-27" /></div>
              <div className="form-field form-field--full"><label className="label" htmlFor="fs-course">Course</label>
                <select id="fs-course" className="input" required value={form.courseId} onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value }))}>
                  <option value="">Choose...</option>{filters.data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            </div>
          )}
        </DataBoundary>
        <h4 style={{ margin: '14px 0 6px' }}>Fee items</h4>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input className="input" placeholder="Label (e.g. Tuition)" value={it.label} onChange={(e) => setItem(i, 'label', e.target.value)} style={{ flex: 2 }} />
            <input className="input" type="number" min="0" step="0.01" placeholder="Amount" value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} style={{ flex: 1 }} />
            <input className="input" type="date" value={it.dueDate} onChange={(e) => setItem(i, 'dueDate', e.target.value)} style={{ flex: 1 }} />
          </div>
        ))}
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setItems((arr) => [...arr, { label: '', amount: '', dueDate: '' }])}><Plus size={12} /> Add item</button>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Creating...' : 'Create structure'}</button></div>
      </form>
    </Modal>
  );
}

function StudentLedger() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const list = useFetch(search.length > 1 ? `/admin/students?search=${encodeURIComponent(search)}` : null);
  return (
    <div>
      <div className="input-wrap" style={{ maxWidth: 340, margin: '12px 0' }}>
        <Search size={14} /><input className="input input--icon" placeholder="Search a student by name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.data?.students?.length > 0 && !selected && (
        <ul className="picklist">
          {list.data.students.map((s) => (
            <li key={s.id}><button type="button" className="btn btn--outline btn--sm" onClick={() => setSelected(s)}>{s.name} ({s.studentCode})</button></li>
          ))}
        </ul>
      )}
      {selected && <StudentLedgerDetail student={selected} onBack={() => setSelected(null)} />}
    </div>
  );
}

function StudentLedgerDetail({ student, onBack }) {
  const fees = useFetch(`/admin/fees/students/${student.id}`);
  const [paying, setPaying] = useState(false);
  const [addingItem, setAddingItem] = useState(false);

  const waive = async (item) => {
    const reason = prompt(`Reason for waiving "${item.label}" (${inr(item.amount)}):`);
    if (!reason) return;
    try { await api.put(`/admin/fees/items/${item.id}/waive`, { reason }); fees.reload(); } catch (e) { alert(e.message); }
  };

  return (
    <DataBoundary loading={fees.loading} error={fees.error} data={fees.data} reload={fees.reload}>
      {fees.data && (
        <div style={{ marginTop: 12 }}>
          <div className="toolbar">
            <strong>{student.name} <span className="muted">({student.studentCode})</span></strong>
            <button type="button" className="btn btn--outline btn--sm" onClick={onBack}>Change student</button>
          </div>
          <div className="stats" style={{ margin: '12px 0' }}>
            <div className="stat"><span className="stat__value">{inr(fees.data.summary.total)}</span><span className="stat__label">Total charged</span></div>
            <div className="stat"><span className="stat__value">{inr(fees.data.summary.paid)}</span><span className="stat__label">Paid</span></div>
            <div className="stat"><span className="stat__value">{inr(fees.data.summary.outstanding)}</span><span className="stat__label">Outstanding</span></div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Item</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th><th /></tr></thead>
              <tbody>
                {fees.data.items.length === 0 ? <tr><td colSpan={6}><EmptyState title="No charges yet" /></td></tr> : fees.data.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label} {i.source === 'manual' && <span className="muted">(manual)</span>}</td>
                    <td className="muted">{i.dueDate ? fmtDate(i.dueDate) : '-'}</td>
                    <td>{inr(i.amount)}</td><td>{inr(i.paid)}</td>
                    <td><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge></td>
                    <td>{['unpaid', 'partial'].includes(i.status) && <button type="button" className="btn btn--outline btn--sm" onClick={() => waive(i)}>Waive</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setAddingItem(true)}><Plus size={13} /> Add charge</button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setPaying(true)} disabled={fees.data.summary.outstanding <= 0}><Banknote size={13} /> Record payment</button>
          </div>
          {addingItem && <AddItemModal studentId={student.id} onClose={() => setAddingItem(false)} onDone={() => { setAddingItem(false); fees.reload(); }} />}
          {paying && <PayModal student={student} items={fees.data.items} onClose={() => setPaying(false)} onDone={() => { setPaying(false); fees.reload(); }} />}
        </div>
      )}
    </DataBoundary>
  );
}

function AddItemModal({ studentId, onClose, onDone }) {
  const [label, setLabel] = useState(''); const [amount, setAmount] = useState(''); const [dueDate, setDueDate] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post(`/admin/fees/students/${studentId}/items`, { label, amount: Number(amount), dueDate: dueDate || undefined }); onDone(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <Modal open title="Add a charge" onClose={onClose} width={380}>
      <form onSubmit={submit}>
        {err && <p className="form-error">{err}</p>}
        <div className="form-field"><label className="label" htmlFor="fi-label">Label</label><input id="fi-label" className="input" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Late fine" /></div>
        <div className="form-field" style={{ marginTop: 10 }}><label className="label" htmlFor="fi-amount">Amount</label><input id="fi-amount" className="input" type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="form-field" style={{ marginTop: 10 }}><label className="label" htmlFor="fi-due">Due date (optional)</label><input id="fi-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary">Add</button></div>
      </form>
    </Modal>
  );
}

function PayModal({ student, items, onClose, onDone }) {
  const open = items.filter((i) => ['unpaid', 'partial'].includes(i.status));
  const outstanding = open.reduce((a, i) => a + (Number(i.amount) - Number(i.paid)), 0);
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.post('/admin/fees/payments', { studentId: student.id, amount: Number(amount), method, reference }); setReceipt(r.payment); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title="Record a payment" onClose={onClose} width={420}>
      {receipt ? (
        <>
          <p className="secret-box">Payment recorded: receipt <strong>{receipt.receiptNo}</strong>.</p>
          <div className="form-actions">
            <a className="btn btn--outline" href={`/api/admin/fees/payments/${receipt.id}/receipt.pdf`} target="_blank" rel="noreferrer"><Receipt size={14} /> View receipt</a>
            <button type="button" className="btn btn--primary" onClick={onDone}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          {err && <p className="form-error">{err}</p>}
          <p className="muted" style={{ marginTop: 0 }}>Outstanding: <strong>{inr(outstanding)}</strong>. The amount is applied to the oldest dues first.</p>
          <div className="form-field"><label className="label" htmlFor="pay-amount">Amount</label><input id="pay-amount" className="input" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="form-field" style={{ marginTop: 10 }}><label className="label" htmlFor="pay-method">Method</label>
            <select id="pay-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="form-field" style={{ marginTop: 10 }}><label className="label" htmlFor="pay-ref">Reference (optional)</label><input id="pay-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / UTR no." /></div>
          <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Recording...' : 'Record payment'}</button></div>
        </form>
      )}
    </Modal>
  );
}

function AllPayments() {
  const [search, setSearch] = useState('');
  const list = useFetch(`/admin/fees/payments${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  return (
    <div>
      <div className="input-wrap" style={{ maxWidth: 340, margin: '12px 0' }}>
        <Search size={14} /><input className="input input--icon" placeholder="Search by student or receipt no." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.payments.length === 0 ? <EmptyState title="No payments yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Receipt</th><th>Student</th><th>Amount</th><th>Method</th><th>Date</th><th /></tr></thead>
              <tbody>
                {list.data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.receiptNo}</td><td>{p.studentName} <span className="muted">({p.studentCode})</span></td>
                    <td>{inr(p.amount)}</td><td>{p.method.replace('_', ' ')}</td><td className="muted">{fmtDate(p.paidAt.slice(0, 10))}</td>
                    <td><a className="btn btn--outline btn--sm" href={`/api/admin/fees/payments/${p.id}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={13} /></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
    </div>
  );
}

const ORDER_TONE = { created: 'gray', paid: 'green', needs_review: 'red', resolved: 'amber' };
const ORDER_LABEL = { created: 'Pending / abandoned', paid: 'Paid', needs_review: 'Needs review', resolved: 'Resolved' };

/** Razorpay orders: a reconciliation view. "Needs review" = the gateway took the money but the ledger could not apply it. */
function OnlinePayments() {
  const [status, setStatus] = useState('');
  const list = useFetch(`/admin/fees/online-orders${status ? `?status=${status}` : ''}`);

  const resolve = async (o) => {
    const note = prompt(`How was this resolved?\n(e.g. "Refunded in Razorpay dashboard" or "Recorded manually, receipt RCPT2026-00012")`);
    if (!note?.trim()) return;
    try { await api.put(`/admin/fees/online-orders/${o.id}/resolve`, { note }); list.reload(); } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <div className="toolbar">
        <select className="input" style={{ maxWidth: 220 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All online orders</option>
          {Object.entries(ORDER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.orders.length === 0 ? <EmptyState title="No online payments yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Student</th><th>Amount</th><th>Status</th><th>Razorpay payment</th><th>Receipt / note</th><th /></tr></thead>
              <tbody>
                {list.data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="muted">{fmtDate(o.createdAt.slice(0, 10))}</td>
                    <td>{o.studentName} <span className="muted">({o.studentCode})</span></td>
                    <td>{inr(o.amount)}</td>
                    <td><Badge tone={ORDER_TONE[o.status]}>{ORDER_LABEL[o.status]}</Badge></td>
                    <td className="muted">{o.razorpayPaymentId || '-'}</td>
                    <td>{o.paymentId ? <a href={`/api/admin/fees/payments/${o.paymentId}/receipt.pdf`} target="_blank" rel="noreferrer">{o.receiptNo}</a> : <span className="muted">{o.failureReason || '-'}</span>}</td>
                    <td>{o.status === 'needs_review' && <button type="button" className="btn btn--outline btn--sm" onClick={() => resolve(o)}>Resolve</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
    </div>
  );
}

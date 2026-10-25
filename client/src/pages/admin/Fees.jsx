import { useTabParam } from '../../hooks/useTabParam.js';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Banknote, BellRing, CalendarClock, Download, FileBarChart2, FileText, Plus, Printer, Receipt, Search, Tag, Trash2, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, Card, FormActions, FormError, FormField, PageBanner, StatCard, Tabs, pending } from '../../components/ui/Ui.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import StepBar from '../../components/ui/StepBar.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import ShareMessage from '../../components/ui/ShareMessage.jsx';
import { feeItemBadge } from '../../utils/fees.js';
import { fmtDate, todayISO } from '../../utils/dates.js';

const inr0 = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHODS = [['cash', 'Cash'], ['cheque', 'Cheque'], ['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['card', 'Card'], ['online', 'Online']];
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'students', label: 'Collect' }, { id: 'remind', label: 'Remind' }, { id: 'dayend', label: 'Day-end' },
  { id: 'structures', label: 'Fee plans' }, { id: 'payments', label: 'All payments' }, { id: 'online', label: 'Online payments' },
];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Where the fee cycle stands, for the step bar: the first step with work waiting. "Dues generated" and "Receipt"
 * happen by themselves (assigning a plan makes the dues; collecting makes the receipt), so the office is never sent there.
 */
function cycleStep(s, go) {
  if (!s.structures) return { current: 'setup', next: { hint: 'Make a fee plan for a class: fee heads, amounts and due dates', label: 'Create a fee plan', onClick: go.newPlan } };
  if (s.itemsTotal === 0 || s.unassigned > 0) {
    return { current: 'assign', next: { hint: s.unassigned ? `${plural(s.unassigned, 'student')} in a class with a fee plan ${s.unassigned === 1 ? 'has' : 'have'} no fees yet` : 'Assign the fee plan to its class to make the dues', label: 'Assign to class', onClick: go.plans } };
  }
  if (s.studentsOverdue > 0) return { current: 'remind', next: { hint: `${plural(s.studentsOverdue, 'student')} overdue, ${inr0(s.overdue)} in all`, label: 'Send reminders', onClick: go.remind } };
  if (s.outstanding > 0) return { current: 'collect', next: { hint: `${inr0(s.outstanding)} still to collect from ${plural(s.studentsWithDues, 'student')}`, label: 'Collect fees', onClick: go.collect } };
  return { current: 'dayend', next: { hint: 'Everything due is paid. Check today\'s collection.', label: 'Day-end summary', onClick: go.dayend } };
}

export default function Fees() {
  const { t } = useTenantConfig();
  const [tab, setTab] = useTabParam('overview');
  const [newStructure, setNewStructure] = useState(false);
  const [ledgerStudent, setLedgerStudent] = useState(null);
  const openLedger = (st) => { setLedgerStudent(st); setTab('students'); };
  // A link from a student's record (?student=<id>) opens that student's ledger straight away
  const [params] = useSearchParams();
  const linked = params.get('student');
  useEffect(() => {
    if (!linked) return;
    api.get(`/admin/students/${linked}`).then((r) => setLedgerStudent({ id: linked, name: r.student.name, studentCode: r.student.studentCode })).catch(() => {});
  }, [linked]);
  const structures = useFetch('/admin/fees/structures');
  const summary = useFetch('/admin/fees/summary');
  const go = {
    newPlan: () => { setTab('structures'); setNewStructure(true); }, plans: () => setTab('structures'), remind: () => setTab('remind'),
    collect: () => { setLedgerStudent(null); setTab('students'); }, dayend: () => setTab('dayend'),
  };
  const reloadAll = () => { summary.reload(); structures.reload(); };

  return (
    <>
      <PageBanner
        icon={Wallet} title="Fees" subtitle={`Fee plans, dues, reminders and collection for ${t('students', 'students').toLowerCase()}`}
        steps={summary.data ? { process: 'fees', waitingOn: 'Fee office', ...cycleStep(summary.data, go) } : undefined}
        primary={{ label: 'Collect a fee', icon: Receipt, onClick: go.collect }}
        actions={(
          <>
            <Link to="/admin/reports?report=fee-collection" className="btn btn--outline btn--sm"><FileBarChart2 size={14} /> Collection report</Link>
            <Link to="/admin/reports?report=fee-dues" className="btn btn--outline btn--sm"><FileBarChart2 size={14} /> Outstanding fees</Link>
          </>
        )}
      />
      <Card>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        {tab === 'overview' && <Overview summary={summary} onOpen={openLedger} onSetup={go.newPlan} />}
        {tab === 'students' && <StudentLedger selected={ledgerStudent} setSelected={setLedgerStudent} onChanged={summary.reload} />}
        {tab === 'remind' && <Remind onChanged={summary.reload} />}
        {tab === 'dayend' && <DayEnd />}
        {tab === 'structures' && (
          <>
            <div className="toolbar"><span className="muted">A fee plan lists a class's fee heads with amounts and due dates. Assign it to the class to make each student's dues.</span><button type="button" className="btn btn--outline btn--sm" onClick={() => setNewStructure(true)}><Plus size={13} /> New fee plan</button></div>
            <DataBoundary loading={structures.loading} error={structures.error} data={structures.data} reload={structures.reload}>
              {structures.data && (structures.data.structures.length === 0 ? <EmptyState title="No fee plans yet" hint="A fee plan lists the charges for a class, such as tuition and exam fee, with due dates." action={{ label: 'Create a fee plan', onClick: () => setNewStructure(true) }} /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Name</th><th>{t('course', 'Course')}</th><th>Year</th><th>Total</th><th>Assigned</th><th /></tr></thead>
                    <tbody>
                      {structures.data.structures.map((s) => <StructureRow key={s.id} s={s} onChanged={reloadAll} />)}
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
      {newStructure && <NewStructureModal onClose={() => setNewStructure(false)} onCreated={() => { setNewStructure(false); reloadAll(); }} />}
    </>
  );
}

function StructureRow({ s, onChanged }) {
  const { confirm, prompt, toast } = useDialogs();
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bulkAssign = async () => {
    if (!(await confirm(`Charge "${s.name}" to every active student of ${s.course} who does not have it yet? Their dues are made straight away.`, { confirmLabel: 'Assign to class' }))) return;
    setBusy(true); setErr('');
    try { const r = await api.post(`/admin/fees/structures/${s.id}/bulk-assign`); toast.success(`Assigned to ${r.studentsAssigned} student(s).`); onChanged(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm(`Delete "${s.name}"?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/fees/structures/${s.id}`); onChanged(); } catch (e) { toast.error(e); }
  };

  return (
    <>
      <tr>
        <td><strong>{s.name}</strong>{err && <div className="form-error" style={{ margin: 0 }}>{err}</div>}</td>
        <td>{s.course}</td><td>{s.academicYear}</td><td>{inr(s.total)}</td><td>{s.assignedCount}</td>
        <td>
          <div className="row-actions">
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={bulkAssign}>Assign to class</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setAssigning(true)}>One student</button>
            {s.assignedCount === 0 && <button aria-label="Delete" title="Delete" type="button" className="btn btn--outline btn--sm" onClick={remove}><Trash2 size={13} /></button>}
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
    <Modal open title="New fee plan" onClose={onClose} width={620}>
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
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Creating...' : 'Create fee plan'}</button></div>
      </form>
    </Modal>
  );
}

/** What the office needs first: what came in, what is still to collect, what is overdue and who owes it. */
function Overview({ summary, onOpen, onSetup }) {
  const { data, loading, error, reload } = summary;
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (data.itemsTotal === 0 ? (
        <EmptyState
          title="No fees charged yet"
          hint={data.structures ? 'Assign a fee plan to its class from the Fee plans tab.' : 'Start by creating a fee plan for a class. Then assign it to the class.'}
          action={{ label: data.structures ? 'Go to fee plans' : 'Create a fee plan', onClick: onSetup }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16, marginTop: 14 }}>
          <div className="stats">
            <StatCard value={inr0(data.collectedThisMonth)} label="Collected this month" icon={Banknote} hint={`${inr0(data.collectedToday)} today, ${inr0(data.collectedLastMonth)} last month`} />
            <StatCard value={inr0(data.outstanding)} label={`Still to collect (${data.studentsWithDues} student${data.studentsWithDues === 1 ? '' : 's'})`} icon={Wallet} {...pending(data.outstanding, { act: 'To collect', clear: 'All paid' })} />
            <StatCard value={inr0(data.overdue)} label={`Overdue (${data.studentsOverdue} student${data.studentsOverdue === 1 ? '' : 's'})`} icon={AlertTriangle} {...pending(data.overdue, { level: 'bad', act: 'Past the due date', clear: 'Nothing overdue' })} />
            <StatCard value={inr0(data.dueThisWeek)} label="Falls due in the next 7 days" icon={CalendarClock} {...(data.dueThisWeek > 0 ? { status: 'info', hint: 'Coming up' } : { status: 'clear', hint: 'Nothing this week' })} />
          </div>
          <div>
            <h3 className="section-title"><AlertTriangle size={16} /> Students with overdue fees</h3>
            {data.overdueStudents.length === 0 ? <EmptyState title="Nobody is overdue" hint="Every charge that is past its due date has been paid." /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Student</th><th>Course</th><th>Overdue since</th><th className="num">Overdue amount</th><th /></tr></thead>
                <tbody>{data.overdueStudents.map((o) => (
                  <tr key={o.studentId}>
                    <td><strong>{o.name}</strong> <span className="muted">({o.studentCode})</span></td>
                    <td>{o.course || '-'}</td>
                    <td><Badge tone="red">{fmtDate(String(o.oldestDue).slice(0, 10))}</Badge></td>
                    <td className="num"><strong>{inr0(o.overdue)}</strong></td>
                    <td><button type="button" className="btn btn--outline btn--sm" onClick={() => onOpen({ id: o.studentId, name: o.name, studentCode: o.studentCode })}><Receipt size={13} /> Open ledger</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>
      ))}
    </DataBoundary>
  );
}

function StudentLedger({ selected, setSelected, onChanged }) {
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const list = useFetch(search.length > 1 ? `/admin/students?search=${encodeURIComponent(search)}` : null);
  const classes = useFetch('/admin/courses');
  const dues = useFetch(classId && !selected ? `/admin/fees/class-dues?courseId=${classId}` : null);
  return (
    <div>
      {!selected && (
        <>
          <p className="muted" style={{ margin: '14px 0 0' }}>Find a student to see their charges, record a payment or add a charge, or pick a class to work down its list.</p>
          <div className="toolbar" style={{ margin: '10px 0 12px' }}>
            <div className="toolbar__filters">
              <div className="input-wrap" style={{ minWidth: 260 }}>
                <Search size={14} /><input className="input input--icon" placeholder="Type a name or student ID" aria-label="Search a student by name or ID" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              </div>
              <select className="input" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSearch(''); }} aria-label="Collect by class or division">
                <option value="">Collect by class or division...</option>
                {(classes.data?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          {search.trim().length === 1 && <p className="note">Type at least 2 letters.</p>}
          {list.data && search.trim().length > 1 && list.data.students?.length === 0 && <p className="note">No student matches "{search.trim()}".</p>}
        </>
      )}
      {list.data?.students?.length > 0 && !selected && search.trim().length > 1 && (
        <ul className="picklist">
          {list.data.students.map((s) => (
            <li key={s.id}><button type="button" className="btn btn--outline btn--sm" onClick={() => setSelected(s)}>{s.name} ({s.studentCode})</button></li>
          ))}
        </ul>
      )}
      {!selected && classId && search.trim().length < 2 && (
        <DataBoundary loading={dues.loading} error={dues.error} data={dues.data} reload={dues.reload}>
          {dues.data && (
            <>
              <p className="note" style={{ marginTop: 0 }}>
                {dues.data.students.length} students · {inr0(dues.data.totals.paid)} collected · <strong>{inr0(dues.data.totals.outstanding)} still to collect</strong>
                {dues.data.totals.overdue > 0 && <> · {inr0(dues.data.totals.overdue)} overdue</>} · {dues.data.totals.clear} fully paid
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Roll no.</th><th>Student</th><th className="num">Charged</th><th className="num">Paid</th><th className="num">Due</th><th /></tr></thead>
                  <tbody>
                    {dues.data.students.map((r) => (
                      <tr key={r.id}>
                        <td className="muted">{r.rollNo || '-'}</td>
                        <td><strong>{r.name}</strong> <span className="muted">({r.studentCode})</span></td>
                        <td className="num">{inr0(r.total)}</td>
                        <td className="num">{inr0(r.paid)}</td>
                        <td className="num">{r.outstanding > 0 ? <>{inr0(r.outstanding)}{r.overdue > 0 && <> <Badge tone="red">Overdue</Badge></>}</> : <Badge tone="green">Clear</Badge>}</td>
                        <td><button type="button" className={`btn btn--sm ${r.outstanding > 0 ? 'btn--primary' : 'btn--outline'}`} onClick={() => setSelected({ id: r.id, name: r.name, studentCode: r.studentCode })}>{r.outstanding > 0 ? 'Collect' : 'View'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DataBoundary>
      )}
      {selected && <StudentLedgerDetail student={selected} onBack={() => setSelected(null)} onChanged={onChanged} />}
    </div>
  );
}

function StudentLedgerDetail({ student, onBack, onChanged }) {
  const { prompt, toast } = useDialogs();
  const fees = useFetch(`/admin/fees/students/${student.id}`);
  const [paying, setPaying] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [conceding, setConceding] = useState(null);
  const changed = () => { fees.reload(); onChanged?.(); };

  const waive = async (item) => {
    const reason = await prompt(`Reason for waiving "${item.label}" (${inr(item.amount)}):`, { required: true, title: 'Waive fee', confirmLabel: 'Waive' });
    if (!reason) return;
    try { await api.put(`/admin/fees/items/${item.id}/waive`, { reason }); changed(); } catch (e) { toast.error(e); }
  };

  return (
    <DataBoundary loading={fees.loading} error={fees.error} data={fees.data} reload={fees.reload}>
      {fees.data && (
        <div style={{ marginTop: 12 }}>
          <div className="toolbar">
            <strong>{student.name} <span className="muted">({student.studentCode})</span></strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setPaying(true)} disabled={fees.data.summary.outstanding <= 0}><Banknote size={13} /> Record payment</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setAddingItem(true)}><Plus size={13} /> Add charge</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={onBack}>Change student</button>
            </div>
          </div>
          <div className="stats stats--3" style={{ margin: '12px 0' }}>
            <StatCard value={inr0(fees.data.summary.total)} label="Total charged" icon={Receipt} />
            <StatCard value={inr0(fees.data.summary.paid)} label="Paid" icon={Banknote} />
            <StatCard value={inr0(fees.data.summary.outstanding)} label="Outstanding" icon={Wallet} {...(fees.data.summary.outstanding > 0 ? { status: 'warn', hint: 'To collect' } : { status: 'good', hint: 'Fully paid' })} />
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
                    <td><Badge tone={feeItemBadge(i).tone}>{feeItemBadge(i).label}</Badge></td>
                    <td>{['unpaid', 'partial'].includes(i.status) && (
                      <div className="row-actions">
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setConceding(i)}><Tag size={13} /> Concession</button>
                        {Number(i.paid) === 0 && <button type="button" className="btn btn--outline btn--sm" onClick={() => waive(i)}>Waive</button>}
                      </div>
                    )}{i.status === 'waived' && i.waivedReason && <span className="muted">{i.waivedReason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {addingItem && <AddItemModal studentId={student.id} onClose={() => setAddingItem(false)} onDone={() => { setAddingItem(false); changed(); }} />}
          {paying && <PayModal student={student} items={fees.data.items} onClose={() => setPaying(false)} onDone={() => { setPaying(false); changed(); }} />}
          {conceding && <ConcessionModal item={conceding} onClose={() => setConceding(null)} onDone={() => { setConceding(null); changed(); }} />}
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
          <StepBar process="fees" current="receipt" next={{ hint: `Receipt ${receipt.receiptNo} is ready, with your logo`, label: 'Open the receipt', onClick: () => window.open(`/api/admin/fees/payments/${receipt.id}/receipt.pdf`, '_blank', 'noopener') }} />
          <p className="secret-box" style={{ marginTop: 12 }}>{inr(receipt.amount)} received from <strong>{student.name}</strong> by {receipt.method.replace('_', ' ')}. Receipt <strong>{receipt.receiptNo}</strong>.</p>
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={onDone}>Done</button>
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
                    <td><a className="btn btn--outline btn--sm" href={`/api/admin/fees/payments/${p.id}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={13} /> Receipt</a></td>
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
  const { confirm, prompt, toast } = useDialogs();
  const [status, setStatus] = useState('');
  const list = useFetch(`/admin/fees/online-orders${status ? `?status=${status}` : ''}`);

  const resolve = async (o) => {
    const note = await prompt('How was this resolved?', { required: true, title: 'Resolve payment', placeholder: 'e.g. Refunded in Razorpay dashboard, or recorded manually with a receipt number' });
    if (!note) return;
    try { await api.put(`/admin/fees/online-orders/${o.id}/resolve`, { note }); list.reload(); } catch (e) { toast.error(e); }
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

/** A concession on one charge: an amount or a share of what is still due, with the reason kept on the ledger. */
function ConcessionModal({ item, onClose, onDone }) {
  const due = Math.round((Number(item.amount) - Number(item.paid)) * 100) / 100;
  const [mode, setMode] = useState('amount');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const amount = mode === 'percent' ? Math.round(due * Number(value || 0)) / 100 : Number(value || 0);
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api.put(`/admin/fees/items/${item.id}/concession`, { amount, reason }); onDone(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Concession on ${item.label}`} onClose={onClose} width={440}>
      <form onSubmit={submit}>
        <FormError error={err} />
        <p className="muted" style={{ marginTop: 0 }}>Still due on this charge: <strong>{inr(due)}</strong>.</p>
        <div className="segmented" role="group" aria-label="Concession as">
          <button type="button" className={`segmented__item ${mode === 'amount' ? 'is-active' : ''}`} aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>Amount (₹)</button>
          <button type="button" className={`segmented__item ${mode === 'percent' ? 'is-active' : ''}`} aria-pressed={mode === 'percent'} onClick={() => setMode('percent')}>Percent (%)</button>
        </div>
        <div className="fields" style={{ marginTop: 10 }}>
          <FormField label={mode === 'percent' ? 'Percent off' : 'Amount off'} required hint={mode === 'percent' && value ? `That is ${inr(amount)}` : undefined}>
            <input className="input" type="number" inputMode="decimal" min="0" max={mode === 'percent' ? 100 : due} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Reason" required hint="Kept on the ledger, for example: merit scholarship"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        </div>
        <FormActions submit={amount > 0 ? `Give ${inr(amount)} off` : 'Give concession'} busyLabel="Saving..." busy={busy} disabled={!(amount > 0)} onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Remind: who owes, with a ready message for each (Copy or WhatsApp), and a send to the student and parent app. */
function Remind({ onChanged }) {
  const { toast } = useDialogs();
  const classes = useFetch('/admin/courses');
  const [courseId, setCourseId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(true);
  const qs = new URLSearchParams(); if (courseId) qs.set('courseId', courseId); if (overdueOnly) qs.set('overdue', '1');
  const list = useFetch(`/admin/fees/reminders?${qs}`);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [late, setLate] = useState(false);
  const rows = list.data?.students || [];
  useEffect(() => { setPicked(new Set(rows.map((r) => r.id))); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/fees/reminders', { studentIds: [...picked], courseId: courseId || undefined, overdueOnly });
      toast.success(`Reminder sent to ${plural(r.sent, 'student')} and their parents in the app.`);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="toolbar" style={{ margin: '12px 0' }}>
        <div className="toolbar__filters">
          <select className="input" style={{ width: 'auto' }} value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Class">
            <option value="">All classes</option>
            {(classes.data?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="check-row"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Only overdue</label>
          {rows.length > 0 && <label className="check-row"><input type="checkbox" checked={rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /> Select all</label>}
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setLate(true)}><CalendarClock size={14} /> Add late fee</button>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy || picked.size === 0} onClick={send}><BellRing size={14} /> {busy ? 'Sending...' : `Send in app (${picked.size})`}</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Each message is ready to send. WhatsApp opens on your phone or WhatsApp Web with the text filled in. "Send in app" puts it in the student's and parent's notifications.</p>
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (
          <DataTable
            caption="Students to remind" rows={rows}
            empty={{ title: overdueOnly ? 'Nobody is overdue' : 'Nobody owes anything', hint: overdueOnly ? 'Untick "Only overdue" to remind everyone with fees due.' : 'Every charge is paid. Check the day-end summary.' }}
            columns={[
              { key: 'pick', label: 'Send', render: (r) => <input type="checkbox" aria-label={`Send to ${r.name}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /> },
              { key: 'name', label: 'Student', render: (r) => <><strong>{r.name}</strong> <span className="muted">({r.studentCode})</span><div className="muted">{r.course}</div></> },
              { key: 'guardian', label: 'Parent', render: (r) => <>{r.guardianName || '-'}<div className="muted">{r.guardianPhone || r.phone || 'No mobile'}{r.parentLinked ? ' · in app' : ''}</div></> },
              { key: 'outstanding', label: 'Due', num: true, render: (r) => inr0(r.outstanding) },
              { key: 'overdue', label: 'Overdue', num: true, render: (r) => (r.overdue > 0 ? <><Badge tone="red">{inr0(r.overdue)}</Badge><div className="muted">since {fmtDate(String(r.oldestDue).slice(0, 10))}</div></> : <span className="muted">-</span>) },
              { key: 'send', label: '', actions: true, render: (r) => <ShareMessage compact message={r.message} whatsapp={r.whatsapp} /> },
            ]}
          />
        )}
      </DataBoundary>
      {late && <LateFeeModal courseId={courseId} courses={classes.data?.courses || []} onClose={() => setLate(false)} onDone={() => { setLate(false); list.reload(); onChanged(); }} />}
    </div>
  );
}

/** Late fee: one charge on each overdue fee that has none yet. Shows how many and how much before anything is saved. */
function LateFeeModal({ courseId: initialCourse, courses, onClose, onDone }) {
  const { toast } = useDialogs();
  const [courseId, setCourseId] = useState(initialCourse);
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await api.post('/admin/fees/late-fees', { courseId: courseId || undefined, amount: Number(amount), preview: !preview });
      if (!preview) setPreview(r);
      else { toast.success(`Late fee added to ${plural(r.charges, 'overdue charge')} (${plural(r.students, 'student')}).`); onDone(); }
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Add a late fee" onClose={onClose} width={460}>
      <form onSubmit={run}>
        <FormError error={err} />
        <div className="fields">
          <FormField label="Class">
            <select className="input" value={courseId} onChange={(e) => { setCourseId(e.target.value); setPreview(null); }}>
              <option value="">All classes</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField label="Late fee per overdue charge" required hint="Added once to each charge past its due date">
            <input className="input" type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} />
          </FormField>
        </div>
        {preview && (preview.charges === 0
          ? <p className="note">No overdue charge is without a late fee. Nothing to add.</p>
          : <p className="note">This adds <strong>{inr(preview.amount)}</strong> to <strong>{plural(preview.charges, 'overdue charge')}</strong> of <strong>{plural(preview.students, 'student')}</strong>: {inr(preview.total)} in all.</p>)}
        <FormActions submit={preview ? 'Add late fees' : 'Check first'} busy={busy} disabled={!(Number(amount) > 0) || (preview && preview.charges === 0)} onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** Day-end: what came in today (or any day), by method and by who took it, to match the cash drawer and the bank. */
function DayEnd() {
  const [date, setDate] = useState(() => todayISO());
  const d = useFetch(`/admin/fees/day-end?date=${date}`);
  const data = d.data;
  return (
    <div>
      <div className="toolbar" style={{ margin: '12px 0' }}>
        <FormField label="Day"><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} /></FormField>
        <div className="row-actions">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => window.print()}><Printer size={14} /> Print</button>
          <a className="btn btn--primary btn--sm" href={`/api/admin/fees/day-end?date=${date}&format=pdf`}><Download size={14} /> Download PDF</a>
        </div>
      </div>
      <DataBoundary loading={d.loading} error={d.error} data={data} reload={d.reload}>
        {data && (data.count === 0 ? (
          <EmptyState title={`Nothing collected on ${fmtDate(data.date)}`} hint="Fees recorded at the desk and paid online show here, with a receipt for each." />
        ) : (
          <>
            <div className="stats stats--3">
              <StatCard value={inr0(data.total)} label={`Collected on ${fmtDate(data.date)}`} icon={Banknote} status="good" hint={plural(data.count, 'receipt')} />
              {data.byMethod.slice(0, 2).map((m) => <StatCard key={m.key} value={inr0(m.amount)} label={m.label} icon={Wallet} hint={plural(m.count, 'receipt')} />)}
            </div>
            <div className="dayend-grid">
              <div>
                <h3 className="section-title">By method</h3>
                <DataTable caption="By method" rowKey="key" rows={data.byMethod} columns={[{ key: 'label', label: 'Method' }, { key: 'count', label: 'Receipts', num: true }, { key: 'amount', label: 'Amount', num: true, render: (m) => inr(m.amount) }]} />
              </div>
              <div>
                <h3 className="section-title">By who took it</h3>
                <DataTable caption="By staff" rowKey="key" rows={data.byStaff} columns={[{ key: 'label', label: 'Taken by' }, { key: 'count', label: 'Receipts', num: true }, { key: 'amount', label: 'Amount', num: true, render: (m) => inr(m.amount) }]} />
              </div>
            </div>
            <h3 className="section-title" style={{ marginTop: 16 }}>Receipts</h3>
            <DataTable
              caption="Receipts" rows={data.receipts}
              columns={[
                { key: 'receiptNo', label: 'Receipt' },
                { key: 'studentName', label: 'Student', render: (r) => <>{r.studentName} <span className="muted">({r.studentCode})</span></> },
                { key: 'methodLabel', label: 'Method', muted: true },
                { key: 'receivedBy', label: 'Taken by', muted: true },
                { key: 'amount', label: 'Amount', num: true, render: (r) => inr(r.amount) },
                { key: 'open', label: '', actions: true, render: (r) => <a className="btn btn--outline btn--sm" href={`/api/admin/fees/payments/${r.id}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={13} /> Receipt</a> },
              ]}
            />
          </>
        ))}
      </DataBoundary>
    </div>
  );
}

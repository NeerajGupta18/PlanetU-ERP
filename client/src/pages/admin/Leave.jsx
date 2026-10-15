import { useState } from 'react';
import { CalendarOff, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { ApplyModal, LEAVE_TONE, LEAVE_WORD, range } from '../employee/Leave.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { officeGrant } from '../../config/staffAreas.js';

const TABS = [
  { id: 'pending', label: 'Waiting' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Not approved' },
  { id: 'balances', label: 'Balances' }, { id: 'types', label: 'Leave types' },
];

function Requests({ status }) {
  const { prompt, confirm, toast } = useDialogs();
  const [search, setSearch] = useState('');
  const list = useFetch(`/admin/leave?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const decide = async (r, decision) => {
    let remark = '';
    if (decision === 'reject') {
      remark = await prompt(`Why is ${r.employeeName}'s leave not approved? They will see this.`, { required: true, title: 'Not approving', confirmLabel: 'Send', danger: true });
      if (!remark) return;
    } else if (!(await confirm(`Approve ${r.typeName} for ${r.employeeName}, ${range(r)} (${r.days} day${r.days === 1 ? '' : 's'})?`, { confirmLabel: 'Approve' }))) return;
    try { await api.put(`/admin/leave/${r.id}`, { decision, remark }); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card>
      <div className="toolbar">
        <div className="input-wrap" style={{ minWidth: 220 }}><Search size={14} /><input className="input input--icon" placeholder="Employee name or ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.requests.length === 0 ? <EmptyState title="Nothing here" hint={status === 'pending' ? 'No leave is waiting for a decision.' : 'No requests in this list.'} /> : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.data.requests.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.employeeName}</strong><div className="muted">{r.employeeCode}{r.department ? ` - ${r.department}` : ''}</div></td>
                    <td data-label="Type">{r.typeName}{r.halfDay && <div className="muted">Half day</div>}</td>
                    <td data-label="Dates">{range(r)}</td>
                    <td data-label="Days">{r.days}</td>
                    <td data-label="Reason">{r.reason || '-'}{r.remark && <div className="muted">{r.remark}</div>}{r.byOffice && <div className="muted">Recorded by the office</div>}</td>
                    <td><Badge tone={LEAVE_TONE[r.status]}>{LEAVE_WORD[r.status]}</Badge></td>
                    <td className="row-actions">{r.status === 'pending' && (<>
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => decide(r, 'approve')}>Approve</button>
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => decide(r, 'reject')}>Reject</button>
                    </>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
    </Card>
  );
}

function Balances() {
  const b = useFetch('/admin/leave/balances');
  return (
    <Card title={b.data ? `Days taken in ${b.data.year}` : 'Days taken'}>
      <DataBoundary loading={b.loading} error={b.error} data={b.data} reload={b.reload}>
        {b.data && (b.data.types.length === 0 ? <EmptyState title="No leave types" hint="Add leave types first." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Employee</th>{b.data.types.map((t) => <th key={t.id}>{t.name}<div className="muted">{t.daysPerYear === null ? 'no limit' : `of ${t.daysPerYear}`}</div></th>)}</tr></thead>
              <tbody>
                {b.data.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td><strong>{e.name}</strong><div className="muted">{e.code}</div></td>
                    {b.data.types.map((t) => {
                      const used = e.used[t.id] || 0;
                      const over = t.daysPerYear !== null && used >= t.daysPerYear && t.daysPerYear > 0;
                      return <td key={t.id}>{over ? <Badge tone="red">{used}</Badge> : used}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
    </Card>
  );
}

function TypeEditor({ type, onClose, onSaved }) {
  const [f, setF] = useState({ name: type.name || '', daysPerYear: type.daysPerYear ?? '', active: type.active !== false });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { if (type.id) await api.put(`/admin/leave/types/${type.id}`, f); else await api.post('/admin/leave/types', f); onSaved(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal open title={type.id ? 'Edit leave type' : 'New leave type'} onClose={onClose} width={440}>
      <form onSubmit={save}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <label className="form-field form-field--full"><span className="label">Name *</span><input className="input" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></label>
          <label className="form-field form-field--full"><span className="label">Days per year</span>
            <input className="input" type="number" min="0" max="366" step="0.5" placeholder="Empty means no limit" value={f.daysPerYear} onChange={(e) => setF({ ...f, daysPerYear: e.target.value })} /></label>
          <div className="form-field form-field--full"><label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use (employees can apply for it)</label></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary">Save</button></div>
      </form>
    </Modal>
  );
}

function Types() {
  const { confirm, toast } = useDialogs();
  const t = useFetch('/admin/leave/types');
  const [editing, setEditing] = useState(null);
  const remove = async (x) => {
    if (!(await confirm(`Delete "${x.name}"?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/leave/types/${x.id}`); t.reload(); } catch (err) { toast.error(err); }
  };
  const defaults = async () => { try { await api.post('/admin/leave/types/defaults'); t.reload(); } catch (err) { toast.error(err); } };
  return (
    <Card title="Leave types" action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing({})}><Plus size={14} /> Add type</button>}>
      <DataBoundary loading={t.loading} error={t.error} data={t.data} reload={t.reload}>
        {t.data && (t.data.types.length === 0 ? (
          <EmptyState title="No leave types yet" hint="Start with the usual ones (casual, sick, earned and unpaid) and change them as you like." action={{ label: 'Add a leave type', onClick: () => setEditing({}) }} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Days per year</th><th>Used in requests</th><th>Status</th><th /></tr></thead>
              <tbody>
                {t.data.types.map((x) => (
                  <tr key={x.id}>
                    <td><strong>{x.name}</strong></td><td>{x.daysPerYear === null ? 'No limit' : x.daysPerYear}</td><td>{x.uses}</td>
                    <td><Badge tone={x.active ? 'green' : 'gray'}>{x.active ? 'In use' : 'Off'}</Badge></td>
                    <td className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(x)} aria-label={`Edit ${x.name}`}><Pencil size={13} /></button>
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => remove(x)} aria-label={`Delete ${x.name}`}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {t.data?.types.length === 0 && <div className="form-actions"><button type="button" className="btn btn--primary" onClick={defaults}>Add the usual types</button></div>}
      </DataBoundary>
      {editing && <TypeEditor type={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); t.reload(); }} />}
    </Card>
  );
}

function RecordModal({ onClose, onSaved }) {
  const emps = useFetch('/admin/employees');
  const types = useFetch('/admin/leave/types');
  const [emp, setEmp] = useState('');
  if (!emps.data || !types.data) return null;
  const active = types.data.types.filter((t) => t.active);
  if (!emp) {
    return (
      <Modal open title="Record leave for" onClose={onClose} width={420}>
        <label className="form-field"><span className="label">Employee *</span>
          <select className="input" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Select...</option>{emps.data.employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.empCode || e.code})</option>)}</select></label>
        <p className="muted">Leave recorded here is approved straight away.</p>
      </Modal>
    );
  }
  return <ApplyModal types={active} employee={emp} onClose={onClose} onSaved={onSaved} />;
}

export default function Leave() {
  const { tenant } = useTenantConfig();
  const { user, office } = useAuth();
  // A head of department decides their department's requests; recording leave and leave types stay with the office
  const deptOnly = user.role === 'employee' && officeGrant(office, '/admin/leave')?.scope === 'department';
  const tabs = deptOnly ? TABS.filter((t) => t.id !== 'types') : TABS;
  const [tab, setTab] = useTabParam('pending', tabs.map((t) => t.id));
  const [recording, setRecording] = useState(false);
  const counts = useFetch('/admin/leave?status=pending');
  const on = useFetch('/admin/leave/on-leave');
  const waiting = counts.data?.counts?.pending || 0;
  const [bump, setBump] = useState(0);

  return (
    <>
      <PageBanner
        icon={CalendarOff} title={deptOnly ? 'Department leave' : 'Leave'} subtitle={deptOnly ? 'Leave requests and balances for your department' : `Requests, balances and leave types${tenant ? '' : ''}`}
        actions={!deptOnly && <button type="button" className="btn btn--primary" onClick={() => setRecording(true)}><Plus size={15} /> Record leave</button>}
      />
      {on.data?.employees.length > 0 && (
        <Card title="On leave today">
          <p style={{ margin: 0 }}>{on.data.employees.map((e) => `${e.name} (${e.typeName}, until ${e.toDate})`).join(', ')}</p>
        </Card>
      )}
      <Tabs tabs={tabs.map((t) => ({ id: t.id, label: t.id === 'pending' && waiting ? `Waiting (${waiting})` : t.label }))} active={tab} onChange={setTab} />
      {['pending', 'approved', 'rejected'].includes(tab) && <Requests key={`${tab}${bump}`} status={tab} />}
      {tab === 'balances' && <Balances key={bump} />}
      {tab === 'types' && <Types />}
      {recording && <RecordModal onClose={() => setRecording(false)} onSaved={() => { setRecording(false); setBump((b) => b + 1); counts.reload(); on.reload(); }} />}
    </>
  );
}

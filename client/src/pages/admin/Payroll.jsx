import { useState } from 'react';
import { Banknote, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { inr } from '../../utils/billing.js';
import { MONTHS, todayISO } from '../../utils/dates.js';

const TABS = [{ id: 'runs', label: 'Monthly payroll' }, { id: 'salaries', label: 'Salaries' }];
export const monthWord = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const num = (v) => (v === '' || v == null ? 0 : Number(v));

function SalaryEditor({ emp, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [f, setF] = useState({ basic: emp.basic ?? '', hra: emp.hra ?? '', allowances: emp.allowances ?? '', pfPercent: emp.pfPercent ?? 12, otherDeductions: emp.otherDeductions ?? '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const gross = num(f.basic) + num(f.hra) + num(f.allowances);
  const pf = Math.round(num(f.basic) * num(f.pfPercent)) / 100;
  const net = gross - pf - num(f.otherDeductions);
  const save = async (e) => {
    e.preventDefault();
    try { await api.put(`/admin/payroll/salaries/${emp.employeeId}`, f); onSaved(); } catch (err) { toast.error(err); }
  };
  return (
    <Modal open title={`Salary - ${emp.name}`} onClose={onClose} width={480}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field"><label className="label" htmlFor="s-basic">Basic pay *</label><input id="s-basic" className="input" type="number" min="0" step="0.01" value={f.basic} onChange={set('basic')} required autoFocus /></div>
          <div className="form-field"><label className="label" htmlFor="s-hra">HRA</label><input id="s-hra" className="input" type="number" min="0" step="0.01" value={f.hra} onChange={set('hra')} /></div>
          <div className="form-field"><label className="label" htmlFor="s-all">Other allowances</label><input id="s-all" className="input" type="number" min="0" step="0.01" value={f.allowances} onChange={set('allowances')} /></div>
          <div className="form-field"><label className="label" htmlFor="s-pf">PF (% of basic)</label><input id="s-pf" className="input" type="number" min="0" max="100" step="0.01" value={f.pfPercent} onChange={set('pfPercent')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="s-other">Other fixed deductions</label><input id="s-other" className="input" type="number" min="0" step="0.01" value={f.otherDeductions} onChange={set('otherDeductions')} /></div>
        </div>
        <p className="muted" style={{ margin: '4px 0 0' }}>Gross {inr(gross)} - PF {inr(pf)} - other {inr(num(f.otherDeductions))} = <strong>{inr(net)}</strong> a month before any unpaid leave.</p>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary">Save</button></div>
      </form>
    </Modal>
  );
}

function Salaries() {
  const { confirm, toast } = useDialogs();
  const [search, setSearch] = useState('');
  const list = useFetch(`/admin/payroll/salaries${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const [editing, setEditing] = useState(null);
  const remove = async (e) => {
    if (!(await confirm(`Remove the salary of ${e.name}? They will be left out of future payroll.`, { danger: true, confirmLabel: 'Remove' }))) return;
    try { await api.del(`/admin/payroll/salaries/${e.employeeId}`); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card title="Salaries">
      <div className="toolbar"><div className="input-wrap" style={{ minWidth: 220 }}><Search size={14} /><input className="input input--icon" placeholder="Name or ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.employees.length === 0 ? <EmptyState title="No employees" hint="Add employees first." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Employee</th><th>Basic</th><th>HRA</th><th>Allowances</th><th>PF</th><th>Gross</th><th /></tr></thead>
              <tbody>
                {list.data.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td><strong>{e.name}</strong><div className="muted">{e.empCode} - {e.designation}</div></td>
                    {e.hasSalary ? (<><td>{inr(e.basic)}</td><td>{inr(e.hra)}</td><td>{inr(e.allowances)}</td><td>{e.pfPercent}%</td><td><strong>{inr(e.gross)}</strong></td></>)
                      : <td colSpan={5}><Badge tone="amber">Salary not set</Badge></td>}
                    <td className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`${e.hasSalary ? 'Edit' : 'Set'} salary of ${e.name}`} onClick={() => setEditing(e)}>{e.hasSalary ? <Pencil size={13} /> : 'Set salary'}</button>
                      {e.hasSalary && <button type="button" className="btn btn--outline btn--sm" aria-label={`Remove salary of ${e.name}`} onClick={() => remove(e)}><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {editing && <SalaryEditor emp={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </Card>
  );
}

function RunDetail({ id, onClose, onChanged }) {
  const { confirm, toast } = useDialogs();
  const d = useFetch(`/admin/payroll/runs/${id}`);
  const finalise = async () => {
    if (!(await confirm('Finalise this month? Employees are emailed and can open their payslips. It cannot be changed afterwards.', { confirmLabel: 'Finalise' }))) return;
    try { await api.post(`/admin/payroll/runs/${id}/finalise`); d.reload(); onChanged(); } catch (err) { toast.error(err); }
  };
  const again = async () => {
    try { await api.post('/admin/payroll/runs', { month: d.data.run.month }); d.reload(); onChanged(); toast.success('Payslips made again from the latest salaries and leave.'); } catch (err) { toast.error(err); }
  };
  const run = d.data?.run;
  return (
    <Modal open title={run ? `Payroll - ${monthWord(run.month)}` : 'Payroll'} onClose={onClose} width={900}>
      <DataBoundary loading={d.loading && !d.data} error={d.error} data={d.data} reload={d.reload}>
        {d.data && (
          <>
            <div className="payslip-sum">
              <div><div className="muted">Status</div><Badge tone={run.status === 'finalised' ? 'green' : 'amber'}>{run.status === 'finalised' ? 'Finalised' : 'Draft'}</Badge></div>
              <div><div className="muted">Payslips</div><strong>{run.payslips}</strong></div>
              <div><div className="muted">Gross</div><strong>{inr(run.gross)}</strong></div>
              <div><div className="muted">Net to pay</div><strong>{inr(run.net)}</strong></div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Employee</th><th>Gross</th><th>PF</th><th>Other</th><th>Unpaid leave</th><th>Net pay</th><th /></tr></thead>
                <tbody>
                  {d.data.payslips.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong><div className="muted">{s.empCode}</div></td>
                      <td>{inr(s.gross)}</td><td>{inr(s.pf)}</td><td>{inr(s.otherDeductions)}</td>
                      <td>{s.unpaidDays ? <>{inr(s.unpaidAmount)}<div className="muted">{s.unpaidDays} day{s.unpaidDays === 1 ? '' : 's'}</div></> : '-'}</td>
                      <td><strong>{inr(s.net)}</strong></td>
                      <td className="row-actions"><a className="btn btn--outline btn--sm" href={`/api/admin/payroll/payslips/${s.id}/pdf`} target="_blank" rel="noreferrer"><FileText size={13} /> PDF</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {run.status === 'draft' && (
              <div className="form-actions">
                <button type="button" className="btn btn--outline" onClick={again}>Make again</button>
                <button type="button" className="btn btn--primary" onClick={finalise}>Finalise and send</button>
              </div>
            )}
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

function Runs() {
  const { confirm, toast } = useDialogs();
  const list = useFetch('/admin/payroll/runs');
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const make = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.post('/admin/payroll/runs', { month }); list.reload(); setOpen(r.run.id); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const remove = async (r) => {
    if (!(await confirm(`Delete the draft for ${monthWord(r.month)}?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/payroll/runs/${r.id}`); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card title="Monthly payroll">
      <form onSubmit={make} className="toolbar" style={{ alignItems: 'end' }}>
        <div className="form-field" style={{ margin: 0 }}><label className="label" htmlFor="pm">Month</label><input id="pm" className="input" type="month" max={todayISO().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} required /></div>
        <button className="btn btn--primary" disabled={busy}><Plus size={14} /> Run payroll</button>
      </form>
      <p className="muted" style={{ margin: '0 0 12px' }}>Everyone with a salary gets a payslip. Approved leave without pay is deducted at gross divided by the days in the month. A draft can be made again until you finalise it.</p>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.runs.length === 0 ? <EmptyState title="No payroll yet" hint="Set salaries, then run payroll for a month." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Month</th><th>Payslips</th><th>Gross</th><th>Net</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.data.runs.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{monthWord(r.month)}</strong></td><td>{r.payslips}</td><td>{inr(r.gross)}</td><td>{inr(r.net)}</td>
                    <td><Badge tone={r.status === 'finalised' ? 'green' : 'amber'}>{r.status === 'finalised' ? 'Finalised' : 'Draft'}</Badge></td>
                    <td className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(r.id)}>Open</button>
                      {r.status === 'draft' && <button type="button" className="btn btn--outline btn--sm" aria-label={`Delete ${monthWord(r.month)}`} onClick={() => remove(r)}><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {open && <RunDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </Card>
  );
}

export default function Payroll() {
  const [tab, setTab] = useTabParam('runs', TABS.map((t) => t.id));
  return (
    <>
      <PageBanner icon={Banknote} title="Payroll" subtitle="Salaries, monthly payslips and unpaid-leave deductions" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'runs' ? <Runs /> : <Salaries />}
    </>
  );
}

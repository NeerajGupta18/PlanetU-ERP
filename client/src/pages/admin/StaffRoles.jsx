import { useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';

/**
 * Staff roles: give an employee an office role (principal, accountant, librarian...). They keep their own employee
 * login and see the pages of that role in their menu - nothing more. Only the institute admin can change this.
 */
export default function StaffRoles() {
  const { data, loading, error, reload } = useFetch('/admin/staff-roles');
  const { confirm, toast } = useDialogs();
  const [giving, setGiving] = useState(null);
  const remove = async (h) => {
    if (!await confirm(`Remove the ${h.roleLabel} role from ${h.name}? Its pages will disappear from their menu.`, { title: 'Remove role', confirmLabel: 'Remove', danger: true })) return;
    try { await api.del(`/admin/staff-roles/${h.employeeId}/${h.role}`); toast.success('Role removed.'); reload(); } catch (err) { toast.error(err); }
  };
  return (
    <>
      <PageBanner icon={ShieldCheck} title="Staff roles" subtitle="Give office staff the pages they need, without the full admin login."
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => setGiving({})}><Plus size={14} /> Give a role</button>} />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <div className="grid-2" style={{ alignItems: 'stretch' }}>
            {data.roles.map((r) => {
              const holders = data.holders.filter((h) => h.role === r.key);
              return (
                <Card key={r.key} title={r.label} icon={ShieldCheck} action={<button type="button" className="btn btn--outline btn--sm" onClick={() => setGiving({ role: r.key })}><Plus size={13} /> Add</button>}>
                  <p className="muted" style={{ marginTop: -6 }}>{r.about}</p>
                  {holders.length === 0 ? <p className="muted" style={{ margin: '10px 0 0' }}><em>Nobody has this role.</em></p> : (
                    <ul className="plain-list" style={{ marginTop: 10 }}>
                      {holders.map((h) => (
                        <li key={h.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                          <span>
                            <strong>{h.name}</strong> <span className="muted">({h.code}{h.designation ? `, ${h.designation}` : ''})</span>
                            {h.department && <> <Badge tone="blue">{h.department}</Badge></>}
                            {!h.hasLogin && <> <Badge tone="amber">No login yet</Badge></>}
                          </span>
                          <button type="button" className="icon-btn" aria-label={`Remove ${r.label} from ${h.name}`} onClick={() => remove(h)}><Trash2 size={15} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}
        {data && data.holders.length === 0 && <Card><EmptyState title="No staff roles given yet" hint="Give your principal, accountant, librarian and other office staff a role so they can do their work." /></Card>}
      </DataBoundary>
      {giving && data && <Give roles={data.roles} preset={giving.role} onClose={() => setGiving(null)} onSaved={() => { setGiving(null); reload(); }} />}
    </>
  );
}

function Give({ roles, preset, onClose, onSaved }) {
  const { toast } = useDialogs();
  const emps = useFetch('/admin/employees');
  const depts = useFetch('/admin/departments');
  const [f, setF] = useState({ role: preset || roles[0].key, employeeId: '', departmentId: '' });
  const [busy, setBusy] = useState(false);
  const role = roles.find((r) => r.key === f.role);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post('/admin/staff-roles', f); toast.success(`${role.label} role given.`); onSaved(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Give a staff role" onClose={onClose} width={480}>
      <form onSubmit={save}>
        <div className="fields fields--1">
          <div className="form-field"><label className="label" htmlFor="sr-role">Role</label>
            <select id="sr-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
            <small className="muted">{role?.about}</small></div>
          <div className="form-field"><label className="label" htmlFor="sr-emp">Employee</label>
            <select id="sr-emp" className="input" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required>
              <option value="">Choose...</option>{(emps.data?.employees || []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code}, {x.designation})</option>)}
            </select></div>
          {role?.department && (
            <div className="form-field"><label className="label" htmlFor="sr-dept">Department they head</label>
              <select id="sr-dept" className="input" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} required>
                <option value="">Choose...</option>{(depts.data?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select></div>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>They sign in with their own employee login. The role's pages appear in their menu straight away.</p>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>Give role</button></div>
      </form>
    </Modal>
  );
}

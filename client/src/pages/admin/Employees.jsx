import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';

export default function Employees() {
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');
  const depts = useFetch('/admin/departments');
  const desigs = useFetch('/admin/designations');

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (department) q.set('department', department);
    if (search) q.set('search', search);
    return q.toString();
  }, [department, search]);
  const emps = useFetch(`/admin/employees${query ? `?${query}` : ''}`);

  const [modal, setModal] = useState(null); // employee object, or { id: null } for add, or null for closed

  const departments = depts.data?.departments || [];
  const designations = desigs.data?.designations || [];

  return (
    <>
      <PageBanner
        icon={Users} title="Employees" subtitle="Manage the staff directory used across Timetable, Duties and Payroll"
        actions={<button type="button" className="btn btn--primary" onClick={() => setModal({ id: null })}><Plus size={15} /> Add Employee</button>}
      />

      <Card>
        <div className="toolbar">
          <div className="toolbar__filters">
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All Departments</option>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <div className="input-wrap" style={{ minWidth: 220 }}>
              <Search size={14} />
              <input className="input input--icon" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Employee list" icon={Users}>
        <DataBoundary loading={emps.loading} error={emps.error} data={emps.data} reload={emps.reload}>
          {emps.data && (
            emps.data.employees.length === 0 ? <EmptyState title="No employees match these filters" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>#</th><th>Name</th><th>Department</th><th>Designation</th><th>Email</th><th>Shift</th><th>Actions</th></tr></thead>
                  <tbody>
                    {emps.data.employees.map((e, i) => (
                      <tr key={e.id}>
                        <td>{i + 1}</td>
                        <td><strong>{e.name}</strong></td>
                        <td>{e.department}</td>
                        <td><Badge tone="purple">{e.designation}</Badge></td>
                        <td className="muted">{e.email}</td>
                        <td className="muted">{e.shift}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal(e)}><Pencil size={13} /></button>
                            <button
                              type="button" className="btn btn--outline btn--sm"
                              onClick={async () => {
                                if (!confirm(`Delete ${e.name}?`)) return;
                                try { await api.del(`/admin/employees/${e.id}`); emps.reload(); }
                                catch (err) { alert(err.message); }
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </DataBoundary>
      </Card>

      <EmployeeModal state={modal} departments={departments} designations={designations} onClose={() => setModal(null)} onSaved={emps.reload} />
    </>
  );
}

const empty = { name: '', email: '', department: '', designation: '', shift: 'Employee shift' };

function EmployeeModal({ state, departments, designations, onClose, onSaved }) {
  const open = !!state;
  const isEdit = !!state?.id;
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== (state.id || 'new')) {
    setForm({ ...(isEdit ? state : { ...empty, department: departments[0]?.name || '' }), __key: state.id || 'new' });
  }

  const deptDesignations = designations.filter((g) => g.department === form.department);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, id, ...payload } = form;
    try {
      if (isEdit) await api.put(`/admin/employees/${state.id}`, payload);
      else await api.post('/admin/employees', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit employee' : 'Add employee'} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field">
          <label className="label">Full name</label>
          <input className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div className="form-field">
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={set('email')} required />
        </div>
        <div className="fields">
          <div className="form-field">
            <label className="label">Department</label>
            <select className="input" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value, designation: '' }))} required>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Designation</label>
            <select className="input" value={form.designation} onChange={set('designation')} required>
              <option value="">-- Select --</option>
              {deptDesignations.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="label">Shift</label>
          <input className="input" value={form.shift} onChange={set('shift')} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}</button>
        </div>
      </form>
    </Modal>
  );
}

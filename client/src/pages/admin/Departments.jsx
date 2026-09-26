import { useState } from 'react';
import { Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';

const TABS = [
  { id: 'departments', label: 'Departments' },
  { id: 'designations', label: 'Designations' },
];

export default function Departments() {
  const [tab, setTab] = useState('departments');
  const depts = useFetch('/admin/departments');
  const desigs = useFetch('/admin/designations');

  const [deptModal, setDeptModal] = useState(null); // { id, name, description } | { id: null } for add
  const [desigModal, setDesigModal] = useState(null);

  const reloadBoth = () => { depts.reload(); desigs.reload(); };

  return (
    <>
      <PageBanner
        icon={Network} title="Departments & Designations"
        subtitle="Manage the organizational structure used across Employees, Course and Fee modules"
        actions={(
          tab === 'departments'
            ? <button type="button" className="btn btn--primary" onClick={() => setDeptModal({ id: null, name: '', description: '' })}><Plus size={15} /> Add Department</button>
            : <button type="button" className="btn btn--primary" onClick={() => setDesigModal({ id: null, name: '', department: '' })}><Plus size={15} /> Add Designation</button>
        )}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'departments' && (
        <Card>
          <DataBoundary loading={depts.loading} error={depts.error} data={depts.data} reload={depts.reload}>
            {depts.data && (
              depts.data.departments.length === 0 ? <EmptyState title="No departments yet" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>#</th><th>Name</th><th>Description</th><th>Employees</th><th>Designations</th><th>Actions</th></tr></thead>
                    <tbody>
                      {depts.data.departments.map((d, i) => (
                        <tr key={d.id}>
                          <td>{i + 1}</td>
                          <td><strong>{d.name}</strong></td>
                          <td className="muted">{d.description || '-'}</td>
                          <td><span className="count-pill">{d.employeeCount}</span></td>
                          <td><span className="count-pill">{d.designationCount}</span></td>
                          <td>
                            <div className="row-actions">
                              <button type="button" className="btn btn--outline btn--sm" onClick={() => setDeptModal(d)}><Pencil size={13} /></button>
                              <button
                                type="button" className="btn btn--outline btn--sm"
                                onClick={async () => {
                                  if (!confirm(`Delete "${d.name}"?`)) return;
                                  try { await api.del(`/admin/departments/${d.id}`); depts.reload(); }
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
      )}

      {tab === 'designations' && (
        <Card>
          <DataBoundary loading={desigs.loading} error={desigs.error} data={desigs.data} reload={desigs.reload}>
            {desigs.data && (
              desigs.data.designations.length === 0 ? <EmptyState title="No designations yet" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>#</th><th>Designation</th><th>Department</th><th>Actions</th></tr></thead>
                    <tbody>
                      {desigs.data.designations.map((g, i) => (
                        <tr key={g.id}>
                          <td>{i + 1}</td>
                          <td><strong>{g.name}</strong></td>
                          <td>{g.department}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button" className="btn btn--outline btn--sm"
                                onClick={async () => {
                                  if (!confirm(`Delete "${g.name}"?`)) return;
                                  try { await api.del(`/admin/designations/${g.id}`); desigs.reload(); }
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
      )}

      <DepartmentModal state={deptModal} onClose={() => setDeptModal(null)} onSaved={reloadBoth} />
      <DesignationModal state={desigModal} departments={depts.data?.departments || []} onClose={() => setDesigModal(null)} onSaved={reloadBoth} />
    </>
  );
}

function DepartmentModal({ state, onClose, onSaved }) {
  const open = !!state;
  const isEdit = !!state?.id;
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== state.id) {
    setForm({ name: state.name || '', description: state.description || '', __key: state.id });
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (isEdit) await api.put(`/admin/departments/${state.id}`, { name: form.name, description: form.description });
      else await api.post('/admin/departments', { name: form.name, description: form.description });
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit department' : 'Add department'} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field">
          <label className="label">Name</label>
          <input className="input" placeholder="e.g., Computer Science" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="form-field">
          <label className="label">Description</label>
          <input className="input" placeholder="e.g., All Computer Science courses" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add department'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DesignationModal({ state, departments, onClose, onSaved }) {
  const open = !!state;
  const [form, setForm] = useState({ name: '', department: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== state.id) {
    setForm({ name: '', department: departments[0]?.name || '', __key: state.id });
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/admin/designations', { name: form.name, department: form.department });
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Add designation" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field">
          <label className="label">Designation name</label>
          <input className="input" placeholder="e.g., Assistant Professor" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="form-field">
          <label className="label">Department</label>
          <select className="input" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} required>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Add designation'}</button>
        </div>
      </form>
    </Modal>
  );
}

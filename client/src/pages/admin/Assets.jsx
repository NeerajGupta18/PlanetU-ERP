import { useState } from 'react';
import { Boxes, Plus, Search, UserRound, Wrench } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';

const STATUS_TONE = { available: 'green', in_use: 'blue', maintenance: 'amber', retired: 'gray' };
const STATUS_LABEL = { available: 'Available', in_use: 'In use', maintenance: 'Maintenance', retired: 'Retired' };

export default function Assets() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [newAsset, setNewAsset] = useState(false);
  const [openId, setOpenId] = useState(null);
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  const list = useFetch(`/admin/assets?${qs}`);

  return (
    <>
      <PageBanner
        icon={Boxes} title="Assets" subtitle="Classrooms, labs, computers and other institute property"
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => setNewAsset(true)}><Plus size={13} /> Add asset</button>}
      />
      <Card>
        <div className="toolbar">
          <select className="input" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="input-wrap" style={{ minWidth: 220 }}><Search size={14} /><input className="input input--icon" placeholder="Name or tag" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.assets.length === 0 ? <EmptyState title="No assets yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tag</th><th>Name</th><th>Category</th><th>Department</th><th>Assigned to</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data.assets.map((a) => (
                    <tr key={a.id}>
                      <td>{a.assetTag}</td><td><strong>{a.name}</strong></td><td>{a.category || '-'}</td>
                      <td className="muted">{a.department || '-'}</td>
                      <td>{a.assignedToName ? `${a.assignedToName} (${a.assignedToCode})` : '-'}</td>
                      <td><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></td>
                      <td><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpenId(a.id)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>
      {newAsset && <NewAssetModal onClose={() => setNewAsset(false)} onDone={() => { setNewAsset(false); list.reload(); }} />}
      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

function NewAssetModal({ onClose, onDone }) {
  const depts = useFetch('/admin/departments');
  const [form, setForm] = useState({ name: '', category: '', departmentId: '', location: '', purchaseDate: '', purchaseValue: '', notes: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.post('/admin/assets', { ...form, purchaseValue: form.purchaseValue ? Number(form.purchaseValue) : undefined, departmentId: form.departmentId || undefined });
      onDone();
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <Modal open title="Add an asset" onClose={onClose} width={560}>
      <form onSubmit={submit}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="as-name">Name</label><input id="as-name" className="input" required value={form.name} onChange={set('name')} placeholder="e.g. Dell laptop" /></div>
          <div className="form-field"><label className="label" htmlFor="as-category">Category</label><input id="as-category" className="input" value={form.category} onChange={set('category')} placeholder="Computer, Furniture..." /></div>
          <div className="form-field"><label className="label" htmlFor="as-dept">Department</label>
            <DataBoundary loading={depts.loading} error={depts.error} data={depts.data}>
              {depts.data && (
                <select id="as-dept" className="input" value={form.departmentId} onChange={set('departmentId')}>
                  <option value="">None</option>{depts.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </DataBoundary>
          </div>
          <div className="form-field"><label className="label" htmlFor="as-loc">Location</label><input id="as-loc" className="input" value={form.location} onChange={set('location')} /></div>
          <div className="form-field"><label className="label" htmlFor="as-date">Purchase date</label><input id="as-date" className="input" type="date" value={form.purchaseDate} onChange={set('purchaseDate')} /></div>
          <div className="form-field"><label className="label" htmlFor="as-value">Purchase value</label><input id="as-value" className="input" type="number" min="0" step="0.01" value={form.purchaseValue} onChange={set('purchaseValue')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="as-notes">Notes</label><input id="as-notes" className="input" value={form.notes} onChange={set('notes')} /></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary">Add asset</button></div>
      </form>
    </Modal>
  );
}

function Detail({ id, onClose, onChanged }) {
  const { data, loading, error, reload } = useFetch(`/admin/assets/${id}`);
  const [err, setErr] = useState('');
  const a = data?.asset;

  const run = async (fn) => { setErr(''); try { await fn(); reload(); onChanged(); } catch (e) { setErr(e.message); } };
  const assign = () => {
    const empId = prompt('Employee id to assign this asset to (use the Employees page to find it):');
    if (!empId) return;
    run(() => api.put(`/admin/assets/${id}/assign`, { employeeId: empId.trim() }));
  };
  const unassign = () => run(() => api.put(`/admin/assets/${id}/unassign`));
  const setStatus = (status) => {
    const note = status === 'retired' || status === 'maintenance' ? prompt(`Note for marking this ${status.replace('_', ' ')}:`) : '';
    run(() => api.put(`/admin/assets/${id}/status`, { status, note: note || undefined }));
  };
  const addMaintenance = () => {
    const note = prompt('What maintenance was performed?');
    if (!note) return;
    const costStr = prompt('Cost (optional):');
    run(() => api.post(`/admin/assets/${id}/maintenance`, { note, cost: costStr ? Number(costStr) : undefined }));
  };

  return (
    <Modal open title={a ? `${a.name} - ${a.assetTag}` : 'Asset'} onClose={onClose} width={640}>
      <DataBoundary loading={loading && !data} error={error} data={data} reload={reload}>
        {a && (
          <>
            {err && <p className="form-error">{err}</p>}
            <div className="fields fields--3" style={{ marginBottom: 16 }}>
              <div><span className="muted">Status</span><br /><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></div>
              <div><span className="muted">Category</span><br />{a.category || '-'}</div>
              <div><span className="muted">Department</span><br />{a.department || '-'}</div>
              <div><span className="muted">Location</span><br />{a.location || '-'}</div>
              <div><span className="muted">Purchased</span><br />{a.purchaseDate ? fmtDate(a.purchaseDate) : '-'}</div>
              <div><span className="muted">Value</span><br />{a.purchaseValue ? `₹${Number(a.purchaseValue).toLocaleString('en-IN')}` : '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span className="muted">Assigned to</span><br />{a.assignedToName ? `${a.assignedToName} (${a.assignedToCode})` : 'Nobody'}</div>
              {a.notes && <div style={{ gridColumn: '1 / -1' }}><span className="muted">Notes</span><br />{a.notes}</div>}
            </div>

            <div className="form-actions" style={{ justifyContent: 'flex-start', marginBottom: 18 }}>
              {a.status !== 'retired' && (a.assignedTo
                ? <button type="button" className="btn btn--outline btn--sm" onClick={unassign}>Unassign</button>
                : <button type="button" className="btn btn--outline btn--sm" onClick={assign}><UserRound size={13} /> Assign</button>)}
              {a.status !== 'maintenance' && a.status !== 'retired' && <button type="button" className="btn btn--outline btn--sm" onClick={() => setStatus('maintenance')}><Wrench size={13} /> Send for maintenance</button>}
              {a.status === 'maintenance' && <button type="button" className="btn btn--outline btn--sm" onClick={() => setStatus('available')}>Back in service</button>}
              {a.status !== 'retired' && <button type="button" className="btn btn--outline btn--sm" onClick={() => setStatus('retired')}>Retire</button>}
              <button type="button" className="btn btn--outline btn--sm" onClick={addMaintenance}>Log maintenance</button>
            </div>

            <h4 style={{ margin: '0 0 8px' }}>History</h4>
            {a.logs.length === 0 ? <EmptyState title="No history yet" /> : (
              <table className="table">
                <tbody>
                  {a.logs.map((l) => (
                    <tr key={l.id}>
                      <td className="muted">{fmtDate(l.loggedAt.slice(0, 10))}</td>
                      <td><strong>{l.action.replace('_', ' ')}</strong>{l.note ? ` - ${l.note}` : ''}{l.cost ? ` (₹${Number(l.cost).toLocaleString('en-IN')})` : ''}</td>
                      <td className="muted">{l.loggedByName || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

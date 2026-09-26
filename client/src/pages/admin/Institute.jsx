import { useState } from 'react';
import {
  Building2, FileText, Landmark, Mail, MapPin, Pencil, PenLine, Phone, Plus, Stamp, Trash2, UserCheck, Users,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, Field, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';

const TABS = [
  { id: 'details', label: 'Institute Details', icon: Building2 },
  { id: 'stakeholders', label: 'Stakeholder Details', icon: Users },
  { id: 'authorized', label: 'Authorized Person Details', icon: UserCheck },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'beneficiary', label: 'Beneficiary Details', icon: Landmark },
  { id: 'stamp', label: 'Stamp & E-Sign', icon: PenLine },
];

export default function Institute() {
  const { data, loading, error, reload } = useFetch('/admin/institute');
  const [tab, setTab] = useState('details');

  return (
    <>
      <PageBanner icon={Building2} title="Institute Details" subtitle="Manage the institute profile and every record on file" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <section className="cover">
              <div className="cover__art" aria-hidden="true" />
              <div className="cover__card">
                <Building2 size={22} />
                <div>
                  <h2>{data.institute.name}</h2>
                  <p>{data.institute.city || data.institute.state ? <><MapPin size={13} /> {[data.institute.city, data.institute.state].filter(Boolean).join(', ')}</> : data.institute.tagline}</p>
                </div>
              </div>
            </section>

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === 'details' && <DetailsTab i={data.institute} reload={reload} />}
            {tab === 'stakeholders' && <StakeholdersTab i={data.institute} reload={reload} />}
            {tab === 'authorized' && <AuthorizedTab i={data.institute} reload={reload} />}
            {tab === 'documents' && <DocumentsTab i={data.institute} reload={reload} />}
            {tab === 'beneficiary' && <BeneficiaryTab i={data.institute} reload={reload} />}
            {tab === 'stamp' && <StampTab i={data.institute} reload={reload} />}
          </>
        )}
      </DataBoundary>
    </>
  );
}

/* =========================================================
   Institute Details
   ========================================================= */
function DetailsTab({ i, reload }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="grid-2">
      <Card
        title="Institute details" icon={Building2}
        action={<button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
      >
        <dl className="fields fields--1">
          <Field label="Name">{i.name}</Field>
          <Field label="Tagline">{i.tagline}</Field>
          <Field label="Address">{i.address || '-'}</Field>
          <Field label="City / State">{[i.city, i.state].filter(Boolean).join(', ') || '-'}</Field>
          <Field label="Pincode">{i.pincode || '-'}</Field>
        </dl>
      </Card>
      <Card title="Contact" icon={Phone}>
        <dl className="fields fields--1">
          <Field label="Phone">{i.phone || '-'}</Field>
          <Field label="Email"><Mail size={13} /> {i.email || '-'}</Field>
          <Field label="Website">{i.website || '-'}</Field>
        </dl>
      </Card>
      <DetailsModal open={editing} institute={i} onClose={() => setEditing(false)} onSaved={reload} />
    </div>
  );
}

function DetailsModal({ open, institute, onClose, onSaved }) {
  const [form, setForm] = useState(institute);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.put('/admin/institute', form); onSaved(); onClose(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Edit institute details" onClose={onClose} width={560}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="fields">
          <div className="form-field"><label className="label">Name</label><input className="input" value={form.name || ''} onChange={set('name')} required /></div>
          <div className="form-field"><label className="label">Tagline</label><input className="input" value={form.tagline || ''} onChange={set('tagline')} /></div>
          <div className="form-field"><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={set('phone')} /></div>
          <div className="form-field"><label className="label">Email</label><input className="input" value={form.email || ''} onChange={set('email')} /></div>
          <div className="form-field"><label className="label">City</label><input className="input" value={form.city || ''} onChange={set('city')} /></div>
          <div className="form-field"><label className="label">State</label><input className="input" value={form.state || ''} onChange={set('state')} /></div>
          <div className="form-field"><label className="label">Pincode</label><input className="input" value={form.pincode || ''} onChange={set('pincode')} /></div>
          <div className="form-field"><label className="label">Website</label><input className="input" value={form.website || ''} onChange={set('website')} /></div>
        </div>
        <div className="form-field"><label className="label">Address</label><input className="input" value={form.address || ''} onChange={set('address')} /></div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* =========================================================
   Stakeholders
   ========================================================= */
function StakeholdersTab({ i, reload }) {
  const [modal, setModal] = useState(null);
  return (
    <Card
      title="Stakeholders" icon={Users}
      action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setModal({ index: null, data: null })}><Plus size={14} /> Add stakeholder</button>}
    >
      {i.stakeholders.length === 0 ? <EmptyState title="No stakeholders yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Actions</th></tr></thead>
            <tbody>
              {i.stakeholders.map((s, idx) => (
                <tr key={idx}>
                  <td><strong>{s.name}</strong></td>
                  <td><Badge tone="purple">{s.role}</Badge></td>
                  <td>{s.email}</td>
                  <td>{s.phone}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal({ index: idx, data: s })}><Pencil size={13} /></button>
                      <button
                        type="button" className="btn btn--outline btn--sm"
                        onClick={async () => { if (confirm(`Remove ${s.name}?`)) { await api.del(`/admin/institute/stakeholders/${idx}`); reload(); } }}
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
      )}
      <StakeholderModal state={modal} onClose={() => setModal(null)} onSaved={reload} />
    </Card>
  );
}

function StakeholderModal({ state, onClose, onSaved }) {
  const open = !!state;
  const isEdit = state?.index !== null && state?.index !== undefined;
  const empty = { name: '', role: '', email: '', phone: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== `${state.index}`) setForm({ ...(state.data || empty), __key: `${state.index}` });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, ...payload } = form;
    try {
      if (isEdit) await api.put(`/admin/institute/stakeholders/${state.index}`, payload);
      else await api.post('/admin/institute/stakeholders', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit stakeholder' : 'Add stakeholder'} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field"><label className="label">Name</label><input className="input" value={form.name} onChange={set('name')} required /></div>
        <div className="form-field"><label className="label">Role</label><input className="input" placeholder="e.g., Director" value={form.role} onChange={set('role')} required /></div>
        <div className="form-field"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={set('email')} /></div>
        <div className="form-field"><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* =========================================================
   Authorized persons
   ========================================================= */
function AuthorizedTab({ i, reload }) {
  const [person, setPerson] = useState(0);
  const [modal, setModal] = useState(null);
  const current = i.authorizedPersons[Math.min(person, i.authorizedPersons.length - 1)];

  return (
    <Card
      title="Authorized persons" icon={UserCheck}
      action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setModal({ index: null, data: null })}><Plus size={14} /> Add person</button>}
    >
      <div className="pills">
        {i.authorizedPersons.map((p, idx) => (
          <button key={p.email + idx} type="button" className={`pill ${person === idx ? 'is-active' : ''}`} onClick={() => setPerson(idx)}>
            <UserCheck size={14} /> {p.name}
          </button>
        ))}
      </div>
      {current && (
        <dl className="fields fields--3 panel">
          <Field label="Name">{current.name}</Field>
          <Field label="Email">{current.email}</Field>
          <Field label="Phone">{current.phone}</Field>
          <Field label="Designation">{current.designation}</Field>
          <Field label="PAN">{current.pan}</Field>
          <Field label="Aadhaar">{current.aadhaar}</Field>
        </dl>
      )}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal({ index: person, data: current })}><Pencil size={13} /> Edit</button>
        <button
          type="button" className="btn btn--outline btn--sm"
          onClick={async () => {
            if (!confirm(`Remove ${current.name} as an authorized person?`)) return;
            try { await api.del(`/admin/institute/authorized-persons/${person}`); setPerson(0); reload(); }
            catch (err) { alert(err.message); }
          }}
        >
          <Trash2 size={13} /> Remove
        </button>
      </div>
      <AuthorizedModal state={modal} onClose={() => setModal(null)} onSaved={reload} />
    </Card>
  );
}

function AuthorizedModal({ state, onClose, onSaved }) {
  const open = !!state;
  const isEdit = state?.index !== null && state?.index !== undefined;
  const empty = { name: '', designation: '', email: '', phone: '', pan: '', aadhaar: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== `${state.index}`) setForm({ ...(state.data || empty), __key: `${state.index}` });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, ...payload } = form;
    try {
      if (isEdit) await api.put(`/admin/institute/authorized-persons/${state.index}`, payload);
      else await api.post('/admin/institute/authorized-persons', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit authorized person' : 'Add authorized person'} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="fields">
          <div className="form-field"><label className="label">Name</label><input className="input" value={form.name} onChange={set('name')} required /></div>
          <div className="form-field"><label className="label">Designation</label><input className="input" value={form.designation} onChange={set('designation')} /></div>
          <div className="form-field"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={set('email')} required /></div>
          <div className="form-field"><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
          <div className="form-field"><label className="label">PAN</label><input className="input" value={form.pan} onChange={set('pan')} /></div>
          <div className="form-field"><label className="label">Aadhaar</label><input className="input" value={form.aadhaar} onChange={set('aadhaar')} /></div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* =========================================================
   Documents
   ========================================================= */
function DocumentsTab({ i, reload }) {
  const [modal, setModal] = useState(null);
  return (
    <Card
      title="Institute documents" icon={FileText}
      action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setModal({ index: null, data: null })}><Plus size={14} /> Add document</button>}
    >
      {i.documents.length === 0 ? <EmptyState title="No documents yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Document</th><th>Issued by</th><th>Valid till</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {i.documents.map((d, idx) => (
                <tr key={idx}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.issuedBy}</td>
                  <td>{d.validTill ? fmtDate(d.validTill) : 'No expiry'}</td>
                  <td><Badge tone={d.status === 'Verified' ? 'green' : d.status === 'Expiring soon' ? 'amber' : 'gray'}>{d.status}</Badge></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal({ index: idx, data: d })}><Pencil size={13} /></button>
                      <button
                        type="button" className="btn btn--outline btn--sm"
                        onClick={async () => { if (confirm(`Remove "${d.name}"?`)) { await api.del(`/admin/institute/documents/${idx}`); reload(); } }}
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
      )}
      <DocumentModal state={modal} onClose={() => setModal(null)} onSaved={reload} />
    </Card>
  );
}

function DocumentModal({ state, onClose, onSaved }) {
  const open = !!state;
  const isEdit = state?.index !== null && state?.index !== undefined;
  const empty = { name: '', issuedBy: '', validTill: '', status: 'Verified' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== `${state.index}`) setForm({ ...empty, ...(state.data || {}), __key: `${state.index}` });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, ...payload } = form;
    try {
      if (isEdit) await api.put(`/admin/institute/documents/${state.index}`, payload);
      else await api.post('/admin/institute/documents', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit document' : 'Add document'} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field"><label className="label">Document name</label><input className="input" value={form.name} onChange={set('name')} required /></div>
        <div className="form-field"><label className="label">Issued by</label><input className="input" value={form.issuedBy} onChange={set('issuedBy')} required /></div>
        <div className="fields">
          <div className="form-field"><label className="label">Valid till (optional)</label><input className="input" type="date" value={form.validTill || ''} onChange={set('validTill')} /></div>
          <div className="form-field">
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              <option>Verified</option><option>Expiring soon</option><option>Pending</option>
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* =========================================================
   Beneficiaries (bank accounts)
   ========================================================= */
function BeneficiaryTab({ i, reload }) {
  const [modal, setModal] = useState(null);
  return (
    <Card
      title="Bank accounts" icon={Landmark}
      action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setModal({ index: null, data: null })}><Plus size={14} /> Add account</button>}
    >
      {i.beneficiaries.length === 0 ? <EmptyState title="No bank accounts yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Account name</th><th>Bank</th><th>Branch</th><th>Account no.</th><th>IFSC</th><th>Type</th><th>Actions</th></tr></thead>
            <tbody>
              {i.beneficiaries.map((b, idx) => (
                <tr key={idx}>
                  <td><strong>{b.accountName}</strong></td><td>{b.bank}</td><td>{b.branch}</td>
                  <td>{b.accountNumber}</td><td>{b.ifsc}</td><td><Badge tone="blue">{b.type}</Badge></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal({ index: idx, data: b })}><Pencil size={13} /></button>
                      <button
                        type="button" className="btn btn--outline btn--sm"
                        onClick={async () => { if (confirm(`Remove "${b.accountName}"?`)) { await api.del(`/admin/institute/beneficiaries/${idx}`); reload(); } }}
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
      )}
      <BeneficiaryModal state={modal} onClose={() => setModal(null)} onSaved={reload} />
    </Card>
  );
}

function BeneficiaryModal({ state, onClose, onSaved }) {
  const open = !!state;
  const isEdit = state?.index !== null && state?.index !== undefined;
  const empty = { accountName: '', bank: '', branch: '', accountNumber: '', ifsc: '', type: 'Current' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== `${state.index}`) setForm({ ...empty, ...(state.data || {}), __key: `${state.index}` });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, ...payload } = form;
    try {
      if (isEdit) await api.put(`/admin/institute/beneficiaries/${state.index}`, payload);
      else await api.post('/admin/institute/beneficiaries', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit bank account' : 'Add bank account'} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field"><label className="label">Account name</label><input className="input" value={form.accountName} onChange={set('accountName')} required /></div>
        <div className="fields">
          <div className="form-field"><label className="label">Bank</label><input className="input" value={form.bank} onChange={set('bank')} required /></div>
          <div className="form-field"><label className="label">Branch</label><input className="input" value={form.branch} onChange={set('branch')} /></div>
          <div className="form-field"><label className="label">Account number</label><input className="input" value={form.accountNumber} onChange={set('accountNumber')} required /></div>
          <div className="form-field"><label className="label">IFSC</label><input className="input" value={form.ifsc} onChange={set('ifsc')} /></div>
          <div className="form-field">
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={set('type')}>
              <option>Current</option><option>Savings</option>
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* =========================================================
   Stamp & e-signature
   ========================================================= */
function StampTab({ i, reload }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card
      title="Stamp and e-signature" icon={Stamp}
      action={<button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
    >
      <div className="seal-grid">
        <figure className="seal">
          <svg viewBox="0 0 200 200" width="170" height="170" role="img" aria-label="Institute stamp">
            <defs>
              <path id="arc-top-admin" d="M 30 100 A 70 70 0 0 1 170 100" />
              <path id="arc-bottom-admin" d="M 22 100 A 78 78 0 0 0 178 100" />
            </defs>
            <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="4" />
            <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <text fontSize="12.5" fontWeight="700" letterSpacing="1" fill="currentColor"><textPath href="#arc-top-admin" startOffset="50%" textAnchor="middle">{i.stamp.stampText}</textPath></text>
            <text fontSize="11.5" fontWeight="600" letterSpacing="2" fill="currentColor"><textPath href="#arc-bottom-admin" startOffset="50%" textAnchor="middle">{i.stamp.stampSub}</textPath></text>
            <text x="100" y="106" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">OFFICIAL</text>
          </svg>
          <figcaption>Institute stamp</figcaption>
        </figure>
        <figure className="signature">
          <div className="signature__ink">{i.stamp.signatory}</div>
          <div className="signature__line" />
          <figcaption><strong>{i.stamp.signatory}</strong><br />{i.stamp.signatoryTitle}</figcaption>
        </figure>
      </div>
      <StampModal open={editing} stamp={i.stamp} onClose={() => setEditing(false)} onSaved={reload} />
    </Card>
  );
}

function StampModal({ open, stamp, onClose, onSaved }) {
  const [form, setForm] = useState(stamp);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.put('/admin/institute/stamp', form); onSaved(); onClose(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Edit stamp & e-signature" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field"><label className="label">Stamp text (top arc)</label><input className="input" value={form.stampText || ''} onChange={set('stampText')} required /></div>
        <div className="form-field"><label className="label">Stamp subtitle (bottom arc)</label><input className="input" value={form.stampSub || ''} onChange={set('stampSub')} /></div>
        <div className="form-field"><label className="label">Signatory name</label><input className="input" value={form.signatory || ''} onChange={set('signatory')} required /></div>
        <div className="form-field"><label className="label">Signatory title</label><input className="input" value={form.signatoryTitle || ''} onChange={set('signatoryTitle')} /></div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

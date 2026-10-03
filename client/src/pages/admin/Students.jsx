import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Download, GraduationCap, Search, Upload, Users2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, Card, Field, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';

const STATUS_TONE = { Active: 'green', Inactive: 'gray', Alumni: 'purple' };

export default function Students() {
  const { t, hasModule } = useTenantConfig();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  const list = useFetch(`/admin/students?${qs}`);

  return (
    <>
      <PageBanner
        icon={Users2} title={t('students', 'Students')} subtitle="Records are created when an applicant is enrolled, or in bulk from a CSV file"
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to={`/admin/reports?report=students${status ? `&status=${status}` : ''}`} className="btn btn--outline btn--sm" style={{ background: '#fff' }}><Download size={14} /> Export list</Link>
            <Link to="/admin/students/import" className="btn btn--primary btn--sm" style={{ background: '#fff', color: 'var(--brand-700)', boxShadow: 'none' }}><Upload size={14} /> Import from CSV</Link>
          </div>
        )}
      />
      <Card>
        <div className="toolbar">
          <div className="toolbar__filters">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option><option>Active</option><option>Inactive</option><option>Alumni</option>
            </select>
          </div>
          <div className="input-wrap" style={{ minWidth: 220 }}>
            <Search size={14} /><input className="input input--icon" placeholder="Name, email or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.students.length === 0 ? <EmptyState title={`No ${t('students', 'students').toLowerCase()} yet`} hint="Enrol an accepted applicant from Admissions to create one." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>ID</th><th>Name</th><th>{t('course', 'Course')}</th><th>Sem / Sec</th><th>Batch</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data.students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.studentCode}</td>
                      <td><strong>{s.name}</strong><div className="muted">{s.email}</div></td>
                      <td>{s.course}</td>
                      <td>{s.semester} / {s.section || '-'}</td>
                      <td className="muted">{s.batch}</td>
                      <td><Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge></td>
                      <td><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpenId(s.id)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>
      {openId && <Detail id={openId} idCards={hasModule('id_cards')} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

function Detail({ id, idCards, onClose, onChanged }) {
  const { data, loading, error, reload } = useFetch(`/admin/students/${id}`);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const s = data?.student;
  if (s && !form) setForm({ section: s.section, semester: s.semester, phone: s.phone, bloodGroup: s.bloodGroup, status: s.status });

  const save = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await api.put(`/admin/students/${id}`, { ...form, semester: Number(form.semester) }); reload(); onChanged(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setErr('');
    try {
      const fd = new FormData(); fd.set('purpose', 'profile'); fd.set('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Upload failed.');
      await api.put(`/admin/students/${id}/photo`, { fileId: body.file.id });
      reload(); onChanged();
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <Modal open title={s ? `${s.name} - ${s.studentCode}` : 'Student'} onClose={onClose} width={720}>
      <DataBoundary loading={loading && !data} error={error} data={data} reload={reload}>
        {s && form && (
          <>
            {err && <p className="form-error">{err}</p>}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 84, height: 100, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {s.photoFileId ? <img src={`/api/files/${s.photoFileId}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="muted" style={{ fontSize: 11 }}>No photo</span>}
              </div>
              <div>
                <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer' }}>
                  <Upload size={13} /> {s.photoFileId ? 'Replace photo' : 'Upload photo'}
                  <input type="file" hidden accept="image/png,image/jpeg" onChange={(e) => { uploadPhoto(e.target.files[0]); e.target.value = ''; }} />
                </label>
                {idCards && (
                  <a className="btn btn--outline btn--sm" href={`/api/admin/students/${id}/id-card.pdf`} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                    <CreditCard size={13} /> ID card
                  </a>
                )}
              </div>
            </div>

            <div className="fields fields--3" style={{ marginBottom: 16 }}>
              <Field label="Course"><GraduationCap size={13} style={{ verticalAlign: -2 }} /> {s.course}</Field>
              <Field label="Enrollment no.">{s.enrollmentNo}</Field>
              <Field label="Admitted">{s.admissionDate ? fmtDate(s.admissionDate) : '-'}</Field>
              <Field label="Email">{s.email}</Field>
              <Field label="Date of birth">{s.dob ? fmtDate(s.dob) : '-'}</Field>
              <Field label="Guardian">{s.guardian?.name || '-'} {s.guardian?.phone && `(${s.guardian.phone})`}</Field>
            </div>

            <form onSubmit={save}>
              <div className="fields">
                <div className="form-field"><label className="label" htmlFor="st-section">Section</label><input id="st-section" className="input" value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} /></div>
                <div className="form-field"><label className="label" htmlFor="st-semester">Semester</label><input id="st-semester" className="input" type="number" min="1" max="20" value={form.semester} onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))} /></div>
                <div className="form-field"><label className="label" htmlFor="st-phone">Phone</label><input id="st-phone" className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
                <div className="form-field"><label className="label" htmlFor="st-blood">Blood group</label><input id="st-blood" className="input" value={form.bloodGroup} onChange={(e) => setForm((f) => ({ ...f, bloodGroup: e.target.value }))} /></div>
                <div className="form-field"><label className="label" htmlFor="st-status">Status</label>
                  <select id="st-status" className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    <option>Active</option><option>Inactive</option><option>Alumni</option>
                  </select>
                  {form.status === 'Inactive' && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Inactive students cannot sign in.</p>}
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn--outline" onClick={onClose}>Close</button>
                <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

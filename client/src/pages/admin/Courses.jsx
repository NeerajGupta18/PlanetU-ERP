import { useState } from 'react';
import { Pencil, Plus, School, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';

/** Classes / courses / programmes (the institute's own word). Everything else - admissions, students, fees, timetable, exams - hangs off these. */
export default function Courses() {
  const { t } = useTenantConfig();
  const one = t('course', 'Course'); const many = t('courses', 'Courses');
  const list = useFetch('/admin/courses');
  const depts = useFetch('/admin/departments');
  const [modal, setModal] = useState(null); // a course, or {} for a new one

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.code}"?`)) return;
    try { await api.del(`/admin/courses/${c.id}`); list.reload(); } catch (e) { window.alert(e.message); }
  };

  return (
    <>
      <PageBanner
        icon={School} title={many}
        subtitle={`Add your ${many.toLowerCase()} first: everything else depends on them`}
        actions={<button type="button" className="btn btn--primary" onClick={() => setModal({})}><Plus size={15} /> Add {one}</button>}
      />
      <Card>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.courses.length === 0
            ? <EmptyState title={`No ${many.toLowerCase()} yet`} hint={`Add your first ${one.toLowerCase()} with the button above. Applicants choose from this list when they apply.`} />
            : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Code</th><th>Name</th><th>Department</th><th className="num">Years</th><th className="num">{t('students', 'Students')}</th><th>Actions</th></tr></thead>
                  <tbody>
                    {list.data.courses.map((c) => (
                      <tr key={c.id}>
                        <td><strong>{c.code}</strong></td>
                        <td>{c.name}{c.fullName && c.fullName !== c.name && <><br /><small className="muted">{c.fullName}</small></>}</td>
                        <td className="muted">{c.departmentName || '-'}</td>
                        <td className="num">{c.years}</td>
                        <td className="num"><span className="count-pill">{c.students}</span></td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn--outline btn--sm" aria-label={`Edit ${c.code}`} onClick={() => setModal(c)}><Pencil size={13} /></button>
                            <button type="button" className="btn btn--outline btn--sm" aria-label={`Delete ${c.code}`} onClick={() => remove(c)}><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </DataBoundary>
      </Card>
      {modal && <CourseModal course={modal} one={one} departments={depts.data?.departments || []} onClose={() => setModal(null)} onSaved={() => { setModal(null); list.reload(); }} />}
    </>
  );
}

function CourseModal({ course, one, departments, onClose, onSaved }) {
  const isNew = !course.id;
  const [f, setF] = useState({ code: course.code || '', name: course.name || '', fullName: course.fullName || '', years: course.years || 1, departmentId: course.departmentId || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const body = { ...f, years: Number(f.years), departmentId: f.departmentId || null };
    try { if (isNew) await api.post('/admin/courses', body); else await api.put(`/admin/courses/${course.id}`, body); onSaved(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title={isNew ? `Add ${one}` : `Edit ${one}`} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="fields">
          <div className="form-field"><label className="label" htmlFor="co-code">Code</label><input id="co-code" className="input" required maxLength={20} placeholder="e.g. BCA, CLS10, MBA" value={f.code} onChange={set('code')} /></div>
          <div className="form-field"><label className="label" htmlFor="co-years">Duration (years)</label><input id="co-years" className="input" type="number" min="1" max="8" required value={f.years} onChange={set('years')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="co-name">Name</label><input id="co-name" className="input" required maxLength={80} placeholder="e.g. BCA" value={f.name} onChange={set('name')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="co-full">Full name (optional)</label><input id="co-full" className="input" maxLength={150} placeholder="e.g. Bachelor of Computer Applications" value={f.fullName} onChange={set('fullName')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="co-dept">Department (optional)</label>
            <select id="co-dept" className="input" value={f.departmentId} onChange={set('departmentId')}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

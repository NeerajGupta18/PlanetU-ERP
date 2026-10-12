import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { Badge, Card, PageBanner, StatCard, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';
import { fileHref } from '../../utils/learning.js';

const DRIVE = { draft: { label: 'Draft', tone: 'amber' }, open: { label: 'Open', tone: 'green' }, closed: { label: 'Closed', tone: 'gray' } };
const APP = { applied: { label: 'Applied', tone: 'blue' }, shortlisted: { label: 'Shortlisted', tone: 'amber' }, selected: { label: 'Selected', tone: 'green' }, rejected: { label: 'Rejected', tone: 'red' }, withdrawn: { label: 'Withdrawn', tone: 'gray' } };
const TABS = [{ id: 'drives', label: 'Drives' }, { id: 'companies', label: 'Companies' }, { id: 'results', label: 'Results' }];

export default function Placement() {
  const [tab, setTab] = useTabParam('drives');
  const stats = useFetch('/admin/placement/stats');
  const s = stats.data;
  return (
    <>
      <PageBanner icon={Briefcase} title="Placement" subtitle="Companies, campus drives and what happens to each application." />
      {s && (
        <div className="stats">
          <StatCard value={s.placed} label="Students placed" icon={Briefcase} tone="green" />
          <StatCard value={s.openDrives} label="Open drives" icon={Briefcase} tone="indigo" />
          <StatCard value={s.average != null ? `${s.average} LPA` : '-'} label="Average package" icon={Briefcase} tone="amber" />
          <StatCard value={s.highest != null ? `${s.highest} LPA` : '-'} label="Highest package" icon={Briefcase} tone="purple" />
        </div>
      )}
      <Card>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        {tab === 'drives' && <Drives onChanged={stats.reload} />}
        {tab === 'companies' && <Companies onChanged={stats.reload} />}
        {tab === 'results' && <Results s={s} />}
      </Card>
    </>
  );
}

function Results({ s }) {
  if (!s) return null;
  return s.byCourse.length === 0 ? <EmptyState title="No students yet" /> : (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Course</th><th className="num">Students</th><th className="num">Placed</th><th className="num">Placement rate</th></tr></thead>
      <tbody>{s.byCourse.map((c) => <tr key={c.course}><td>{c.course}</td><td className="num">{c.students}</td><td className="num">{c.placed}</td><td className="num">{c.students ? Math.round((c.placed / c.students) * 100) : 0}%</td></tr>)}</tbody>
    </table></div>
  );
}

function Companies({ onChanged }) {
  const { confirm, toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/admin/placement/companies');
  const [edit, setEdit] = useState(null);
  const remove = async (c) => {
    if (!await confirm(`Delete ${c.name}?`, { title: 'Delete company', confirmLabel: 'Delete', danger: true })) return;
    try { await api.del(`/admin/placement/companies/${c.id}`); reload(); onChanged(); } catch (err) { toast.error(err); }
  };
  return (
    <>
      <div className="toolbar"><span /><button type="button" className="btn btn--primary btn--sm" onClick={() => setEdit({})}><Plus size={14} /> Add company</button></div>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.companies.length === 0 ? <EmptyState title="No companies yet" hint="Add the companies that visit your campus." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Company</th><th>Contact</th><th className="num">Drives</th><th /></tr></thead>
            <tbody>{data.companies.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong><br /><small className="muted">{c.industry || '-'}</small></td>
                <td>{c.contactName || '-'}<br /><small className="muted">{[c.contactEmail, c.contactPhone].filter(Boolean).join(' · ')}</small></td>
                <td className="num">{c.drives}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => setEdit(c)}><Pencil size={15} /></button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </DataBoundary>
      {edit && <CompanyEditor company={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged(); }} />}
    </>
  );
}

function CompanyEditor({ company, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [f, setF] = useState({ name: company.name || '', industry: company.industry || '', website: company.website || '', contactName: company.contactName || '', contactEmail: company.contactEmail || '', contactPhone: company.contactPhone || '', notes: company.notes || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { if (company.id) await api.put(`/admin/placement/companies/${company.id}`, f); else await api.post('/admin/placement/companies', f); onSaved(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={company.id ? 'Edit company' : 'Add company'} onClose={onClose} width={520}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="pc-name">Name *</label><input id="pc-name" className="input" value={f.name} maxLength={120} onChange={set('name')} required autoFocus /></div>
          <div className="form-field"><label className="label" htmlFor="pc-ind">Industry</label><input id="pc-ind" className="input" value={f.industry} maxLength={80} onChange={set('industry')} /></div>
          <div className="form-field"><label className="label" htmlFor="pc-web">Website</label><input id="pc-web" className="input" value={f.website} maxLength={200} onChange={set('website')} /></div>
          <div className="form-field"><label className="label" htmlFor="pc-cn">Contact person</label><input id="pc-cn" className="input" value={f.contactName} maxLength={100} onChange={set('contactName')} /></div>
          <div className="form-field"><label className="label" htmlFor="pc-ce">Contact email</label><input id="pc-ce" type="email" className="input" value={f.contactEmail} maxLength={120} onChange={set('contactEmail')} /></div>
          <div className="form-field"><label className="label" htmlFor="pc-cp">Contact phone</label><input id="pc-cp" className="input" value={f.contactPhone} maxLength={30} onChange={set('contactPhone')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="pc-notes">Notes</label><input id="pc-notes" className="input" value={f.notes} maxLength={1000} onChange={set('notes')} /></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function Drives({ onChanged }) {
  const { data, loading, error, reload } = useFetch('/admin/placement/drives');
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="toolbar"><span /><button type="button" className="btn btn--primary btn--sm" onClick={() => setEdit({})}><Plus size={14} /> New drive</button></div>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.drives.length === 0 ? <EmptyState title="No drives yet" hint="Add a company first, then create a drive for it." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Drive</th><th>Package</th><th>Dates</th><th className="num">Applicants</th><th className="num">Selected</th><th>Status</th><th /></tr></thead>
            <tbody>{data.drives.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.company}</strong><br /><small className="muted">{d.title}</small></td>
                <td>{d.ctcLpa != null ? `${d.ctcLpa} LPA` : '-'}</td>
                <td><small>{d.driveDate ? `Drive ${fmtDate(d.driveDate)}` : '-'}{d.applyBy ? <><br />Apply by {fmtDate(d.applyBy)}</> : null}</small></td>
                <td className="num">{d.applicants}</td><td className="num">{d.selected}</td>
                <td><Badge tone={DRIVE[d.status].tone}>{DRIVE[d.status].label}</Badge></td>
                <td><Link className="btn btn--primary btn--sm" to={`/admin/placement/drives/${d.id}`}>Open</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </DataBoundary>
      {edit && <DriveEditor drive={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged(); }} />}
    </>
  );
}

function DriveEditor({ drive, onClose, onSaved }) {
  const { toast } = useDialogs();
  const companies = useFetch('/admin/placement/companies');
  const courses = useFetch('/admin/courses');
  const [f, setF] = useState({
    companyId: drive.companyId || '', title: drive.title || '', description: drive.description || '', ctcLpa: drive.ctcLpa ?? '', location: drive.location || '',
    driveDate: drive.driveDate ? String(drive.driveDate).slice(0, 10) : '', applyBy: drive.applyBy ? String(drive.applyBy).slice(0, 10) : '',
    courseIds: drive.courseIds || [], minSemester: drive.minSemester ?? '', minAttendance: drive.minAttendance ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (id) => setF((x) => ({ ...x, courseIds: x.courseIds.includes(id) ? x.courseIds.filter((c) => c !== id) : [...x.courseIds, id] }));
  const save = async (e, publish = false) => {
    e.preventDefault(); setBusy(true);
    try {
      if (drive.id) await api.put(`/admin/placement/drives/${drive.id}`, f); else await api.post('/admin/placement/drives', { ...f, publish });
      onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const list = courses.data?.courses || [];
  return (
    <Modal open title={drive.id ? 'Edit drive' : 'New drive'} onClose={onClose} width={640}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field"><label className="label" htmlFor="pd-co">Company *</label>
            <select id="pd-co" className="input" value={f.companyId} onChange={set('companyId')} required><option value="">Choose...</option>{(companies.data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="form-field"><label className="label" htmlFor="pd-title">Role *</label><input id="pd-title" className="input" value={f.title} maxLength={150} onChange={set('title')} required /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="pd-desc">Details</label><textarea id="pd-desc" className="input" rows={3} maxLength={3000} value={f.description} onChange={set('description')} /></div>
          <div className="form-field"><label className="label" htmlFor="pd-ctc">Package (LPA)</label><input id="pd-ctc" type="number" min="0" step="0.1" className="input" value={f.ctcLpa} onChange={set('ctcLpa')} /></div>
          <div className="form-field"><label className="label" htmlFor="pd-loc">Location</label><input id="pd-loc" className="input" value={f.location} maxLength={100} onChange={set('location')} /></div>
          <div className="form-field"><label className="label" htmlFor="pd-date">Drive date</label><input id="pd-date" type="date" className="input" value={f.driveDate} onChange={set('driveDate')} /></div>
          <div className="form-field"><label className="label" htmlFor="pd-by">Last date to apply</label><input id="pd-by" type="date" className="input" value={f.applyBy} onChange={set('applyBy')} /></div>
          <div className="form-field"><label className="label" htmlFor="pd-sem">Minimum semester</label><input id="pd-sem" type="number" min="1" max="20" className="input" value={f.minSemester} onChange={set('minSemester')} /></div>
          <div className="form-field"><label className="label" htmlFor="pd-att">Minimum attendance (%)</label><input id="pd-att" type="number" min="0" max="100" className="input" value={f.minAttendance} onChange={set('minAttendance')} /></div>
          <div className="form-field form-field--full"><span className="label">Open to (leave empty for every course)</span>
            <div className="badges">{list.map((c) => <label key={c.id} style={{ marginRight: 12 }}><input type="checkbox" checked={f.courseIds.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}</div></div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--outline" disabled={busy}>Save</button>
          {!drive.id && <button type="button" className="btn btn--primary" disabled={busy} onClick={(e) => save(e, true)}>Save and open</button>}
        </div>
      </form>
    </Modal>
  );
}

export function DriveDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { confirm, toast } = useDialogs();
  const { data, loading, error, reload } = useFetch(`/admin/placement/drives/${id}`);
  const [deciding, setDeciding] = useState(null);
  const [edit, setEdit] = useState(false);
  const act = async (verb) => { try { await api.post(`/admin/placement/drives/${id}/${verb}`); reload(); } catch (err) { toast.error(err); } };
  const remove = async () => {
    if (!await confirm('Delete this drive?', { title: 'Delete drive', confirmLabel: 'Delete', danger: true })) return;
    try { await api.del(`/admin/placement/drives/${id}`); nav('/admin/placement'); } catch (err) { toast.error(err); }
  };
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (() => {
        const d = data.drive;
        return (
          <>
            <PageBanner icon={Briefcase} title={`${d.company}: ${d.title}`} subtitle={[d.ctcLpa != null && `${d.ctcLpa} LPA`, d.location, d.driveDate && `Drive ${fmtDate(d.driveDate)}`].filter(Boolean).join(' · ')}
              actions={<Link to="/admin/placement" className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Back</Link>} />
            <Card title="Drive" action={<Badge tone={DRIVE[d.status].tone}>{DRIVE[d.status].label}</Badge>}>
              {d.description && <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>}
              <p className="muted">Open to: {d.courseNames.length ? d.courseNames.join(', ') : 'every course'}{d.minSemester ? ` · semester ${d.minSemester}+` : ''}{d.minAttendance != null ? ` · ${d.minAttendance}% attendance or more` : ''}</p>
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                {d.status !== 'open' && <button type="button" className="btn btn--primary btn--sm" onClick={() => act('open')}>{d.status === 'draft' ? 'Open for applications' : 'Reopen'}</button>}
                {d.status === 'open' && <button type="button" className="btn btn--outline btn--sm" onClick={() => act('close')}>Close applications</button>}
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setEdit(true)}>Edit</button>
                <button type="button" className="btn btn--outline btn--sm" onClick={remove}>Delete</button>
              </div>
            </Card>
            <Card title={`Applications (${data.applications.length})`}>
              {data.applications.length === 0 ? <EmptyState title="No applications yet" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Student</th><th>Course</th><th>Status</th><th>Resume</th><th /></tr></thead>
                  <tbody>{data.applications.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.name}</strong><br /><small className="muted">{a.studentCode} · Sem {a.semester}</small></td>
                      <td>{a.course || '-'}</td>
                      <td><Badge tone={APP[a.status].tone}>{APP[a.status].label}</Badge>{a.offerLpa != null && <> <small>{a.offerLpa} LPA</small></>}</td>
                      <td>{a.resumeFileId ? <a href={fileHref(a.resumeFileId)} target="_blank" rel="noreferrer"><FileText size={14} /> Open</a> : <span className="muted">-</span>}</td>
                      <td>{a.status !== 'withdrawn' && <button type="button" className="btn btn--primary btn--sm" onClick={() => setDeciding(a)}>Update</button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
            {deciding && <Decide app={deciding} defaultOffer={d.ctcLpa} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); reload(); }} />}
            {edit && <DriveEditor drive={d} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
          </>
        );
      })()}
    </DataBoundary>
  );
}

function Decide({ app, defaultOffer, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [status, setStatus] = useState(app.status);
  const [offerLpa, setOffer] = useState(app.offerLpa ?? defaultOffer ?? '');
  const [note, setNote] = useState(app.note || '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.put(`/admin/placement/applications/${app.id}`, { status, offerLpa, note }); toast.success('Updated. The student is told by email.'); onSaved(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={app.name} onClose={onClose} width={440}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="dc-st">Status</label>
            <select id="dc-st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{['applied', 'shortlisted', 'selected', 'rejected'].map((s) => <option key={s} value={s}>{APP[s].label}</option>)}</select></div>
          {status === 'selected' && <div className="form-field form-field--full"><label className="label" htmlFor="dc-offer">Offer (LPA)</label><input id="dc-offer" type="number" min="0" step="0.1" className="input" value={offerLpa} onChange={(e) => setOffer(e.target.value)} /></div>}
          <div className="form-field form-field--full"><label className="label" htmlFor="dc-note">Note for the student</label><input id="dc-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

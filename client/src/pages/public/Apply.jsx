import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, GraduationCap } from 'lucide-react';
import { pub } from '../../api/public.js';
import { Badge, Card } from '../../components/ui/Ui.jsx';
import { ErrorState, FullPageLoader } from '../../components/ui/Feedback.jsx';
import RobotCheck from '../../components/auth/RobotCheck.jsx';
import DocumentsPanel from '../../components/admissions/DocumentsPanel.jsx';
import { STATUS } from '../../components/admissions/status.js';

const blank = {
  name: '', email: '', phone: '', dob: '', gender: '', courseId: '', address: '',
  guardian: { name: '', relation: '', phone: '' }, previousEducation: { institution: '', qualification: '', year: '', percentage: '' },
};

export default function Apply() {
  const { code } = useParams();
  const key = `erp.apply.${code}`;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(() => JSON.parse(localStorage.getItem(key) || 'null')); // { id, accessCode, applicationNo }
  const [app, setApp] = useState(null);
  const [form, setForm] = useState(blank);
  const [captcha, setCaptcha] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { pub(code, '/info').then(setInfo).catch(setError); }, [code]);
  useEffect(() => {
    if (!draft) return;
    pub(code, `/applications/${draft.id}`, { accessCode: draft.accessCode }).then((r) => setApp(r.application)).catch(() => { localStorage.removeItem(key); setDraft(null); });
  }, [draft, code, key]);

  if (error) return <div className="public-page"><ErrorState error={error} /></div>;
  if (!info) return <FullPageLoader />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const nest = (g, k) => (e) => setForm((f) => ({ ...f, [g]: { ...f[g], [k]: e.target.value } }));
  const title = info.terminology?.admission || 'Admissions';

  const create = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!captcha) return setFormError('Tick "I\'m not a robot" first.');
    setBusy(true);
    try {
      const r = await pub(code, '/applications', { method: 'POST', body: { ...form, captchaToken: captcha } });
      const saved = { id: r.id, accessCode: r.accessCode, applicationNo: r.applicationNo };
      localStorage.setItem(key, JSON.stringify(saved));
      setDraft(saved);
    } catch (err) {
      setFormError(err.message); setCaptcha(null); setResetKey((k) => k + 1);
    } finally { setBusy(false); }
  };

  return (
    <div className="public-page">
      <header className="public-page__head">
        <span className="banner__icon"><GraduationCap size={22} /></span>
        <div><h1>{info.institute.name}</h1><p>{title} - application form</p></div>
      </header>

      {!draft && (
        <Card title="Your details">
          <form onSubmit={create}>
            {formError && <p className="form-error">{formError}</p>}
            <div className="fields">
              <div className="form-field"><label className="label">Full name *</label><input className="input" value={form.name} onChange={set('name')} required /></div>
              <div className="form-field"><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={set('email')} required /></div>
              <div className="form-field"><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
              <div className="form-field"><label className="label">Date of birth *</label><input className="input" type="date" value={form.dob} onChange={set('dob')} required /></div>
              <div className="form-field"><label className="label">Gender</label>
                <select className="input" value={form.gender} onChange={set('gender')}><option value="">-</option><option>Female</option><option>Male</option><option>Other</option></select></div>
              <div className="form-field"><label className="label">Applying for *</label>
                <select className="input" value={form.courseId} onChange={set('courseId')} required>
                  <option value="">Select...</option>{info.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="form-field form-field--full"><label className="label">Address</label><input className="input" value={form.address} onChange={set('address')} /></div>
              <div className="form-field"><label className="label">Guardian name</label><input className="input" value={form.guardian.name} onChange={nest('guardian', 'name')} /></div>
              <div className="form-field"><label className="label">Relation</label><input className="input" value={form.guardian.relation} onChange={nest('guardian', 'relation')} /></div>
              <div className="form-field"><label className="label">Guardian phone</label><input className="input" value={form.guardian.phone} onChange={nest('guardian', 'phone')} /></div>
              <div className="form-field"><label className="label">Last school / institution</label><input className="input" value={form.previousEducation.institution} onChange={nest('previousEducation', 'institution')} /></div>
              <div className="form-field"><label className="label">Qualification</label><input className="input" value={form.previousEducation.qualification} onChange={nest('previousEducation', 'qualification')} /></div>
              <div className="form-field"><label className="label">Year / Percentage</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder="2024" maxLength={4} value={form.previousEducation.year} onChange={nest('previousEducation', 'year')} />
                  <input className="input" placeholder="88" value={form.previousEducation.percentage} onChange={nest('previousEducation', 'percentage')} />
                </div></div>
            </div>
            <RobotCheck onChange={setCaptcha} resetKey={resetKey} />
            <div className="form-actions">
              <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Continue to documents'}</button>
            </div>
          </form>
          <p className="muted" style={{ marginTop: 12 }}>Already applied? <Link to={`/apply/${code}/status`}>Check your application status</Link></p>
        </Card>
      )}

      {draft && app && (
        <>
          <AccessCard draft={draft} app={app} code={code} />
          <Card title="Documents">
            <DocumentsPanel code={code} app={app} accessCode={draft.accessCode} onChange={setApp} />
          </Card>
        </>
      )}
    </div>
  );
}

export function AccessCard({ draft, app, code }) {
  const [copied, setCopied] = useState(false);
  const s = STATUS[app.status];
  return (
    <Card title={`Application ${app.applicationNo}`} action={<Badge tone={s.tone}>{s.label}</Badge>}>
      <div className="secret-box">
        <div>Application number: <strong>{app.applicationNo}</strong></div>
        <div>Access code: <code>{draft.accessCode}</code></div>
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>
        Save these two - you need them to check your status or fix a document later. We can't show the access code again.{' '}
        <button type="button" className="btn btn--outline btn--sm" onClick={() => { navigator.clipboard?.writeText(`${app.applicationNo} / ${draft.accessCode}`); setCopied(true); }}>
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>{' '}
        <Link to={`/apply/${code}/status`}>Status page</Link>
      </p>
      {app.decisionNote && <p style={{ marginTop: 10 }}><strong>Message from the institute:</strong> {app.decisionNote}</p>}
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, CreditCard, GraduationCap, Pencil, Printer, Save, Send } from 'lucide-react';
import { pub } from '../../api/public.js';
import { loadRazorpay } from '../../hooks/useRazorpay.js';
import { Badge, Card } from '../../components/ui/Ui.jsx';
import { ErrorState, FullPageLoader } from '../../components/ui/Feedback.jsx';
import RobotCheck from '../../components/auth/RobotCheck.jsx';
import DocumentsPanel from '../../components/admissions/DocumentsPanel.jsx';
import Stepper from '../../components/admissions/Stepper.jsx';
import { DOC_LABEL, DOC_TONE, STATUS, inr } from '../../components/admissions/status.js';
import { fmtDate } from '../../utils/dates.js';

const STEPS = [
  { n: 1, title: 'Course' },
  { n: 2, title: 'Personal details' },
  { n: 3, title: 'Parents' },
  { n: 4, title: 'Education' },
  { n: 5, title: 'Documents' },
  { n: 6, title: 'Review and submit' },
];
const STEP_OF_CODE = { STEP_COURSE: 1, STEP_PERSONAL: 2, STEP_PARENTS: 3, STEP_EDUCATION: 4, STEP_DOCUMENTS: 5, STEP_PAYMENT: 6 };
const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS', 'Other'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const blank = {
  courseId: '', name: '', email: '', phone: '', dob: '', gender: '', address: '',
  personal: { nationality: 'Indian', category: '', bloodGroup: '' },
  guardian: { fatherName: '', motherName: '', name: '', relation: '', phone: '', email: '', occupation: '' },
  previousEducation: { institution: '', qualification: '', board: '', year: '', percentage: '', tenth: { board: '', year: '', percentage: '' } },
  entrance: { exam: '', rollNo: '', score: '' },
};
const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : (v ?? base[k]);
  }
  return out;
};
const today = new Date().toISOString().slice(0, 10);

export default function Apply() {
  const { code } = useParams();
  const key = `erp.apply.${code}`;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }); // { id, accessCode, applicationNo }
  const [app, setApp] = useState(null);
  const [form, setForm] = useState(blank);
  const [step, setStep] = useState(1);
  const [captcha, setCaptcha] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');
  const [agree, setAgree] = useState(false);
  const later = useRef(false);
  const justCreated = useRef(false); // a brand-new draft keeps the step the applicant is on

  useEffect(() => { pub(code, '/info').then(setInfo).catch(setError); }, [code]);

  // Open the saved application (if this device has one) and land on the step where the applicant stopped
  useEffect(() => {
    if (!draft) return;
    pub(code, `/applications/${draft.id}`, { accessCode: draft.accessCode }).then((r) => {
      const a = r.application;
      setApp(a);
      if (justCreated.current) { justCreated.current = false; return; }
      setForm((f) => merge(f, a.form));
      setStep(a.status === 'documents_pending' ? 5 : Math.min(a.step, 6));
    }).catch(() => { localStorage.removeItem(key); setDraft(null); });
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="public-page"><ErrorState error={error} /></div>;
  if (!info) return <FullPageLoader />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const nest = (g, k) => (e) => setForm((f) => ({ ...f, [g]: { ...f[g], [k]: e.target.value } }));
  const nest2 = (g, h, k) => (e) => setForm((f) => ({ ...f, [g]: { ...f[g], [h]: { ...f[g][h], [k]: e.target.value } } }));
  const title = info.terminology?.admission || 'Admissions';
  const settings = info.settings || {};
  const editable = app && ['draft', 'documents_pending'].includes(app.status);
  const reached = app ? Math.min(Math.max(app.step, step), 6) : 1;

  const fail = (err) => {
    setFormError(err.message);
    const to = STEP_OF_CODE[err.data?.code];
    if (to && to !== step) setStep(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Step 1 starts the application; every later step saves into it. "Save for later" skips the form's own checks. */
  const saveStep = async (e, next) => {
    e?.preventDefault();
    const exit = later.current; later.current = false;
    setFormError(''); setSaved(''); setBusy('save');
    try {
      if (!draft) {
        if (!captcha) throw new Error('Tick "I\'m not a robot" first.');
        const r = await pub(code, '/applications', { method: 'POST', body: { courseId: form.courseId, name: form.name, email: form.email, phone: form.phone, captchaToken: captcha } });
        const d = { id: r.id, accessCode: r.accessCode, applicationNo: r.applicationNo };
        localStorage.setItem(key, JSON.stringify(d));
        justCreated.current = true;
        setDraft(d);
        setStep(exit ? 1 : next);
        if (exit) setSaved(`Saved. Come back any time with application number ${d.applicationNo} and your access code.`);
        return;
      }
      const fields = { 1: ['courseId', 'name', 'email', 'phone'], 2: ['dob', 'gender', 'address', 'personal'], 3: ['guardian'], 4: ['previousEducation', 'entrance'], 5: [], 6: [] }[step];
      const body = Object.fromEntries(fields.map((k) => [k, form[k]]));
      const r = await pub(code, `/applications/${draft.id}/steps/${step}`, { method: 'PUT', accessCode: draft.accessCode, body });
      setApp(r.application);
      if (exit) setSaved(`Saved. You can carry on later with application number ${draft.applicationNo} and your access code.`);
      else { setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    } catch (err) {
      setFormError(err.message);
      if (!draft) { setCaptcha(null); setResetKey((k) => k + 1); }
    } finally { setBusy(''); }
  };

  const submit = async () => {
    setFormError(''); setBusy('submit');
    try { setApp((await pub(code, `/applications/${draft.id}/submit`, { method: 'POST', accessCode: draft.accessCode })).application); window.scrollTo({ top: 0 }); }
    catch (err) { fail(err); } finally { setBusy(''); }
  };

  const payOnline = async () => {
    setFormError(''); setBusy('pay');
    try {
      if (!(await loadRazorpay())) throw new Error('Could not load the secure payment form. Check your internet connection and try again.');
      const order = await pub(code, `/applications/${draft.id}/fee/order`, { method: 'POST', accessCode: draft.accessCode });
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amountPaise, currency: order.currency,
        name: info.institute.name, description: `Application fee - ${draft.applicationNo}`, prefill: order.prefill, theme: { color: '#4029c9' },
        modal: { ondismiss: () => setBusy('') },
        handler: async (resp) => {
          try {
            const r = await pub(code, `/applications/${draft.id}/fee/verify`, { method: 'POST', accessCode: draft.accessCode, body: resp });
            setApp(r.application);
            if (r.status === 'pending') setSaved('We have your payment and are waiting for the bank to confirm it. This page will show it as paid in a few minutes - you do not need to pay again.');
          } catch {
            setSaved('Your payment went through, but we could not confirm it just now. Please wait a few minutes and reopen this page - you do not need to pay again.');
          } finally { setBusy(''); }
        },
      });
      rzp.on('payment.failed', (r) => { setFormError(r?.error?.description || 'The payment did not go through. You have not been charged - please try again.'); setBusy(''); });
      rzp.open();
    } catch (err) { setFormError(err.message); setBusy(''); }
  };

  const Head = (
    <header className="public-page__head">
      <span className="banner__icon"><GraduationCap size={22} /></span>
      <div><h1>{info.institute.name}</h1><p>{title} - application form</p></div>
    </header>
  );

  if (!settings.accepting && !draft) {
    return (
      <div className="public-page">{Head}
        <Card><p style={{ margin: 0 }}>Applications are not being accepted right now. Please check back later or contact the institute.</p></Card>
      </div>
    );
  }

  /* ---- already submitted: show where it stands ---- */
  if (app && !editable) {
    return (
      <div className="public-page">{Head}
        <Card title="Application submitted" icon={CheckCircle2} action={<Badge tone={STATUS[app.status].tone}>{STATUS[app.status].label}</Badge>}>
          <div className="secret-box">
            <div>Application number: <strong>{app.applicationNo}</strong></div>
            <div>Name: <strong>{app.name}</strong> - {app.course}</div>
          </div>
          <p>The institute will check your documents and update you by email. You can follow progress on the status page with your application number and access code.</p>
          {app.decisionNote && <p><strong>Message from the institute:</strong> {app.decisionNote}</p>}
          <div className="form-actions no-print">
            <button type="button" className="btn btn--outline" onClick={() => window.print()}><Printer size={15} /> Print</button>
            <Link className="btn btn--primary" to={`/apply/${code}/status`}>Open status page</Link>
          </div>
        </Card>
      </div>
    );
  }

  const feeLine = settings.applicationFee > 0 && !draft && (
    <p className="wizard-note">Application fee: <strong>{inr(settings.applicationFee)}</strong>{info.paymentsOnline ? ' - paid online in the last step.' : ' - paid at the institute office.'}</p>
  );

  return (
    <div className="public-page">
      {Head}
      {settings.instructions && !draft && <p className="wizard-note" style={{ whiteSpace: 'pre-wrap' }}>{settings.instructions}</p>}
      {feeLine}
      <Stepper steps={STEPS} current={step} reached={draft ? reached : 1} onGo={setStep} />
      {draft && app && <AccessCard draft={draft} app={app} code={code} />}
      {app?.status === 'documents_pending' && (
        <p className="wizard-note wizard-note--warn">Some of your documents need attention. Replace them in step 5, then submit again from step 6.</p>
      )}
      {saved && <p className="wizard-note wizard-note--ok" role="status">{saved}</p>}
      {formError && <p className="form-error" role="alert">{formError}</p>}

      {step === 1 && (
        <Card title="Choose your course">
          <form onSubmit={(e) => saveStep(e, 2)}>
            <div className="fields">
              <div className="form-field form-field--full"><label className="label">Applying for *</label>
                <select className="input" value={form.courseId} onChange={set('courseId')} required>
                  <option value="">Select...</option>{info.courses.map((c) => <option key={c.id} value={c.id}>{c.fullName || c.name}</option>)}
                </select></div>
              <div className="form-field"><label className="label">Full name *</label><input className="input" value={form.name} onChange={set('name')} required autoComplete="name" /></div>
              <div className="form-field"><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></div>
              <div className="form-field"><label className="label">Mobile number *</label><input className="input" type="tel" value={form.phone} onChange={set('phone')} required autoComplete="tel" /></div>
            </div>
            {!draft && <RobotCheck onChange={setCaptcha} resetKey={resetKey} />}
            <div className="wizard-actions">
              <span className="muted">Already started? <Link to={`/apply/${code}/status`}>Continue or check status</Link></span>
              <div className="wizard-actions__right">
                {draft && <button type="submit" className="btn btn--outline" formNoValidate disabled={!!busy} onClick={() => { later.current = true; }}><Save size={15} /> Save for later</button>}
                <button type="submit" className="btn btn--primary" disabled={!!busy}>{busy === 'save' ? 'Saving...' : 'Save and continue'} <ArrowRight size={15} /></button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {step === 2 && draft && (
        <Card title="Personal details">
          <form onSubmit={(e) => saveStep(e, 3)}>
            <div className="fields">
              <div className="form-field"><label className="label">Date of birth *</label><input className="input" type="date" max={today} value={form.dob || ''} onChange={set('dob')} required /></div>
              <div className="form-field"><label className="label">Gender</label>
                <select className="input" value={form.gender} onChange={set('gender')}><option value="">-</option><option>Female</option><option>Male</option><option>Other</option></select></div>
              <div className="form-field"><label className="label">Nationality</label><input className="input" value={form.personal.nationality} onChange={nest('personal', 'nationality')} /></div>
              <div className="form-field"><label className="label">Category</label>
                <select className="input" value={form.personal.category} onChange={nest('personal', 'category')}><option value="">-</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="form-field"><label className="label">Blood group</label>
                <select className="input" value={form.personal.bloodGroup} onChange={nest('personal', 'bloodGroup')}><option value="">-</option>{BLOOD.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="form-field form-field--full"><label className="label">Address *</label><textarea className="input" rows={2} value={form.address} onChange={set('address')} required /></div>
            </div>
            <h4 style={{ margin: '18px 0 6px' }}>Photo and signature</h4>
            <DocumentsPanel code={code} app={app || { ...blankApp(draft) }} accessCode={draft.accessCode} onChange={setApp} types={['photo', 'signature']} showSubmit={false} />
            <Nav busy={busy} onBack={() => setStep(1)} later={later} />
          </form>
        </Card>
      )}

      {step === 3 && draft && (
        <Card title="Parents and guardian">
          <form onSubmit={(e) => saveStep(e, 4)}>
            <div className="fields">
              <div className="form-field"><label className="label">Father's name</label><input className="input" value={form.guardian.fatherName} onChange={nest('guardian', 'fatherName')} /></div>
              <div className="form-field"><label className="label">Mother's name</label><input className="input" value={form.guardian.motherName} onChange={nest('guardian', 'motherName')} /></div>
              <div className="form-field"><label className="label">Guardian to contact *</label><input className="input" value={form.guardian.name} onChange={nest('guardian', 'name')} required /></div>
              <div className="form-field"><label className="label">Relation</label><input className="input" placeholder="Father, Mother, Uncle..." value={form.guardian.relation} onChange={nest('guardian', 'relation')} /></div>
              <div className="form-field"><label className="label">Guardian's phone *</label><input className="input" type="tel" value={form.guardian.phone} onChange={nest('guardian', 'phone')} required /></div>
              <div className="form-field"><label className="label">Guardian's email</label><input className="input" type="email" value={form.guardian.email} onChange={nest('guardian', 'email')} /></div>
              <div className="form-field"><label className="label">Occupation</label><input className="input" value={form.guardian.occupation} onChange={nest('guardian', 'occupation')} /></div>
            </div>
            <Nav busy={busy} onBack={() => setStep(2)} later={later} />
          </form>
        </Card>
      )}

      {step === 4 && draft && (
        <Card title="Education">
          <form onSubmit={(e) => saveStep(e, 5)}>
            <p className="muted" style={{ marginTop: 0 }}>Fill in what applies to you. Leave the rest empty.</p>
            <h4 style={{ margin: '4px 0 8px' }}>Last qualification</h4>
            <div className="fields">
              <div className="form-field"><label className="label">School / college</label><input className="input" value={form.previousEducation.institution} onChange={nest('previousEducation', 'institution')} /></div>
              <div className="form-field"><label className="label">Qualification</label><input className="input" placeholder="12th, Diploma, B.Sc..." value={form.previousEducation.qualification} onChange={nest('previousEducation', 'qualification')} /></div>
              <div className="form-field"><label className="label">Board / university</label><input className="input" value={form.previousEducation.board} onChange={nest('previousEducation', 'board')} /></div>
              <div className="form-field"><label className="label">Year of passing</label><input className="input" inputMode="numeric" maxLength={4} placeholder="2024" value={form.previousEducation.year} onChange={nest('previousEducation', 'year')} /></div>
              <div className="form-field"><label className="label">Percentage</label><input className="input" inputMode="decimal" placeholder="88.5" value={form.previousEducation.percentage} onChange={nest('previousEducation', 'percentage')} /></div>
            </div>
            <h4 style={{ margin: '18px 0 8px' }}>10th standard</h4>
            <div className="fields fields--3">
              <div className="form-field"><label className="label">Board</label><input className="input" value={form.previousEducation.tenth.board} onChange={nest2('previousEducation', 'tenth', 'board')} /></div>
              <div className="form-field"><label className="label">Year</label><input className="input" inputMode="numeric" maxLength={4} value={form.previousEducation.tenth.year} onChange={nest2('previousEducation', 'tenth', 'year')} /></div>
              <div className="form-field"><label className="label">Percentage</label><input className="input" inputMode="decimal" value={form.previousEducation.tenth.percentage} onChange={nest2('previousEducation', 'tenth', 'percentage')} /></div>
            </div>
            <h4 style={{ margin: '18px 0 8px' }}>Entrance exam (if any)</h4>
            <div className="fields fields--3">
              <div className="form-field"><label className="label">Exam</label><input className="input" placeholder="JEE, CET, CUET..." value={form.entrance.exam} onChange={nest('entrance', 'exam')} /></div>
              <div className="form-field"><label className="label">Roll number</label><input className="input" value={form.entrance.rollNo} onChange={nest('entrance', 'rollNo')} /></div>
              <div className="form-field"><label className="label">Score / rank</label><input className="input" value={form.entrance.score} onChange={nest('entrance', 'score')} /></div>
            </div>
            <Nav busy={busy} onBack={() => setStep(3)} later={later} />
          </form>
        </Card>
      )}

      {step === 5 && draft && app && (
        <Card title="Upload documents">
          <DocumentsPanel code={code} app={app} accessCode={draft.accessCode} onChange={setApp} types={['id_proof', 'marksheet', 'other']} showSubmit={false} />
          <form onSubmit={(e) => saveStep(e, 6)}>
            <Nav busy={busy} onBack={() => setStep(4)} later={later} next="Continue to review" />
          </form>
        </Card>
      )}

      {step === 6 && draft && app && (
        <Review
          app={app} form={form} info={info} busy={busy} agree={agree} setAgree={setAgree} editable={editable}
          onEdit={setStep} onBack={() => setStep(5)} onSubmit={submit} onPay={payOnline}
        />
      )}
    </div>
  );
}

/** A stand-in used for the photo/signature slots before the application has loaded. */
const blankApp = (d) => ({ id: d.id, status: 'draft', requiredDocuments: ['photo', 'id_proof', 'marksheet'], documents: [] });

function Nav({ busy, onBack, later, next = 'Save and continue' }) {
  return (
    <div className="wizard-actions">
      <button type="button" className="btn btn--outline" onClick={onBack} disabled={!!busy}><ArrowLeft size={15} /> Back</button>
      <div className="wizard-actions__right">
        <button type="submit" className="btn btn--outline" formNoValidate disabled={!!busy} onClick={() => { later.current = true; }}><Save size={15} /> Save for later</button>
        <button type="submit" className="btn btn--primary" disabled={!!busy}>{busy === 'save' ? 'Saving...' : next} <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

function Review({ app, form, info, busy, agree, setAgree, editable, onEdit, onBack, onSubmit, onPay }) {
  const course = info.courses.find((c) => c.id === form.courseId);
  const g = form.guardian; const e = form.previousEducation; const x = form.entrance;
  const Row = ({ k, v }) => <><dt>{k}</dt><dd>{v || '-'}</dd></>;
  const Block = ({ n, title, children }) => (
    <div className="review-block">
      <div className="review-block__head"><h4>{title}</h4><button type="button" className="btn btn--outline btn--sm" onClick={() => onEdit(n)}><Pencil size={12} /> Edit</button></div>
      <dl>{children}</dl>
    </div>
  );
  const fee = app.fee;
  const missing = app.requiredDocuments.filter((t) => !app.documents.some((d) => d.docType === t));
  const mustPay = fee.status === 'pending' && app.paymentsOnline;
  return (
    <Card title="Review and submit">
      <div className="review-grid">
        <Block n={1} title="Course and contact">
          <Row k="Course" v={course?.fullName || course?.name} /><Row k="Name" v={form.name} /><Row k="Email" v={form.email} /><Row k="Mobile" v={form.phone} />
        </Block>
        <Block n={2} title="Personal details">
          <Row k="Date of birth" v={form.dob && fmtDate(form.dob)} /><Row k="Gender" v={form.gender} /><Row k="Nationality" v={form.personal.nationality} />
          <Row k="Category" v={form.personal.category} /><Row k="Blood group" v={form.personal.bloodGroup} /><Row k="Address" v={form.address} />
        </Block>
        <Block n={3} title="Parents and guardian">
          <Row k="Father" v={g.fatherName} /><Row k="Mother" v={g.motherName} /><Row k="Guardian" v={[g.name, g.relation && `(${g.relation})`].filter(Boolean).join(' ')} />
          <Row k="Phone" v={g.phone} /><Row k="Email" v={g.email} /><Row k="Occupation" v={g.occupation} />
        </Block>
        <Block n={4} title="Education">
          <Row k="Last qualification" v={[e.qualification, e.institution].filter(Boolean).join(', ')} /><Row k="Board" v={e.board} />
          <Row k="Year / percentage" v={[e.year, e.percentage && `${e.percentage}%`].filter(Boolean).join(' - ')} />
          <Row k="10th" v={[e.tenth.board, e.tenth.year, e.tenth.percentage && `${e.tenth.percentage}%`].filter(Boolean).join(' - ')} />
          <Row k="Entrance exam" v={[x.exam, x.rollNo, x.score].filter(Boolean).join(' - ')} />
        </Block>
        <div className="review-block">
          <div className="review-block__head"><h4>Documents</h4><button type="button" className="btn btn--outline btn--sm" onClick={() => onEdit(5)}><Pencil size={12} /> Edit</button></div>
          {app.documents.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing uploaded yet.</p> : (
            <ul className="todo" style={{ margin: 0 }}>
              {app.documents.map((d) => <li key={d.id}>{DOC_LABEL[d.docType]} - <span className="muted">{d.name}</span> <Badge tone={DOC_TONE[d.status]}>{d.status}</Badge></li>)}
            </ul>
          )}
          {missing.length > 0 && <p className="form-error" style={{ marginBottom: 0 }}>Still needed: {missing.map((t) => DOC_LABEL[t]).join(', ')}.</p>}
        </div>

        {fee.status !== 'none' && (
          <div className={`fee-box ${fee.status === 'pending' ? '' : 'fee-box--paid'}`}>
            <div>
              <strong>Application fee</strong>
              <div className="fee-box__amount">{inr(fee.amount)}</div>
              {fee.status === 'paid' && <span className="muted">Paid{fee.reference ? ` - ref. ${fee.reference}` : ''}</span>}
              {fee.status === 'waived' && <span className="muted">Waived by the institute</span>}
              {fee.status === 'pending' && !app.paymentsOnline && <span className="muted">Pay this at the institute's accounts office. You can submit your application now.</span>}
            </div>
            {fee.status === 'pending' && app.paymentsOnline && (
              <button type="button" className="btn btn--primary" onClick={onPay} disabled={!!busy}><CreditCard size={15} /> {busy === 'pay' ? 'Opening...' : `Pay ${inr(fee.amount)} online`}</button>
            )}
            {fee.status !== 'pending' && <CheckCircle2 size={28} color="var(--green)" />}
          </div>
        )}
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, fontSize: 14 }}>
        <input type="checkbox" checked={agree} onChange={(ev) => setAgree(ev.target.checked)} style={{ marginTop: 3 }} />
        <span>I confirm that the information and documents I have given are correct and complete.</span>
      </label>
      <div className="wizard-actions">
        <button type="button" className="btn btn--outline" onClick={onBack} disabled={!!busy}><ArrowLeft size={15} /> Back</button>
        <button type="button" className="btn btn--primary" disabled={!agree || !editable || !!busy || mustPay || missing.length > 0} onClick={onSubmit}>
          <Send size={15} /> {busy === 'submit' ? 'Submitting...' : app.status === 'documents_pending' ? 'Resubmit application' : 'Submit application'}
        </button>
      </div>
      {mustPay && <p className="muted" style={{ textAlign: 'right', marginBottom: 0 }}>Pay the application fee to submit.</p>}
    </Card>
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
        Save these two - you need them to carry on from another phone or computer, or to check your status. We can't show the access code again; if you lose it we can email you a new one.{' '}
        <button type="button" className="btn btn--outline btn--sm" onClick={() => { navigator.clipboard?.writeText(`${app.applicationNo} / ${draft.accessCode}`); setCopied(true); }}>
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>{' '}
        <Link to={`/apply/${code}/status`}>Status page</Link>
      </p>
      {app.decisionNote && <p style={{ marginTop: 10 }}><strong>Message from the institute:</strong> {app.decisionNote}</p>}
    </Card>
  );
}

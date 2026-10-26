import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Building2, CalendarRange, CheckCircle2, Download, FlaskConical, ImagePlus, IndianRupee, Mail, Plus, Rocket,
  School, Trash2, Upload, UserPlus, Users2,
} from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { Badge, Card, FormError, FormField, PageHeader } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import StaffImport from '../../components/campus/StaffImport.jsx';
import { PROCESSES } from '../../config/processes.js';
import { SWATCHES, applyBrandColor, whiteContrast } from '../../lib/brandTheme.js';

const STEPS = PROCESSES.setup.steps;
const labelOf = (key) => STEPS.find((s) => s.key === key)?.label;

/** What each step asks for, in one line (the "Next:" hint under the step bar). */
const ASK = {
  profile: 'Check your institute\'s details, add your logo and pick your colour',
  year: 'Set the first and last day of this academic year',
  classes: 'Add the classes you teach and their divisions',
  subjects: 'List the subjects of each class and who teaches them',
  fees: 'Add the fee heads of each class (tuition, exam fee...)',
  import: 'Bring in your students and staff from a spreadsheet',
  invite: 'Send everyone their sign-in details',
};

/**
 * Institute setup: the seven steps from an empty institute to its first class, with a progress bar. Each step is
 * one short form; "Save and continue" moves on, and any step can be opened again from the step bar.
 */
export default function Setup() {
  const { data, error, loading, reload } = useFetch('/admin/setup');
  const [tab, setTab] = useTabParam('');
  const current = STEPS.some((s) => s.key === tab) ? tab : data?.current || 'profile';
  const index = STEPS.findIndex((s) => s.key === current);
  const go = (key) => { setTab(key); window.scrollTo?.({ top: 0, behavior: 'smooth' }); };
  const nextKey = STEPS[index + 1]?.key;
  const done = () => { reload(); if (nextKey) go(nextKey); else go('finished'); };

  const finished = tab === 'finished' || (data?.complete && !tab);

  return (
    <>
      <PageHeader
        icon={Rocket} title="Set up your institute"
        subtitle="Seven short steps from an empty institute to its first class. Your work is saved at every step, so you can stop and come back."
        steps={data && !finished ? {
          process: 'setup', current,
          done: data.steps.filter((s) => s.done).map((s) => s.key),
          reached: STEPS[STEPS.length - 1].key, onGo: go,
          next: { hint: ASK[current] },
        } : undefined}
      />
      <DataBoundary loading={loading && !data} error={error} data={data} reload={reload}>
        {data && (
          <>
            <Progress w={data} />
            {finished ? <Finished w={data} onOpen={go} /> : (
              <div className="setup-grid">
                <div className="setup-main">
                  {current === 'profile' && <ProfileStep w={data} onDone={done} />}
                  {current === 'year' && <YearStep w={data} onDone={done} />}
                  {current === 'classes' && <ClassesStep w={data} onDone={done} reload={reload} />}
                  {current === 'subjects' && <SubjectsStep w={data} onDone={done} reload={reload} />}
                  {current === 'fees' && <FeesStep w={data} onDone={done} reload={reload} />}
                  {current === 'import' && <ImportStep w={data} onDone={done} reload={reload} />}
                  {current === 'invite' && <InviteStep w={data} onDone={done} reload={reload} />}
                  <p className="setup-skip">
                    {nextKey
                      ? <button type="button" className="link-btn" onClick={() => go(nextKey)}>Skip for now: go to {labelOf(nextKey)}</button>
                      : <button type="button" className="link-btn" onClick={() => go('finished')}>Skip for now: see what is left</button>}
                  </p>
                </div>
                <aside className="setup-side">
                  <SampleData w={data} reload={reload} />
                </aside>
              </div>
            )}
          </>
        )}
      </DataBoundary>
    </>
  );
}

function Progress({ w }) {
  const pct = Math.round((w.done / w.total) * 100);
  return (
    <div className="setup-progress">
      <div className="setup-progress__text">
        <strong>{w.complete ? 'Setup complete' : `${w.done} of ${w.total} steps done`}</strong>
        <span className="muted">{pct}%</span>
      </div>
      <div className="progress" role="progressbar" aria-label="Setup steps done" aria-valuemin={0} aria-valuemax={w.total} aria-valuenow={w.done}>
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The step's one primary button, with the "Save and continue" wording used on every step. */
function StepActions({ busy, label = 'Save and continue', onClick, disabled, children }) {
  return (
    <div className="form-actions">
      {children}
      <button type={onClick ? 'button' : 'submit'} className="btn btn--primary" disabled={busy || disabled} onClick={onClick}>
        {busy ? 'Saving...' : label} {!busy && <ArrowRight size={15} aria-hidden="true" />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ 1. Profile and logo */


function ProfileStep({ onDone, w }) {
  const { refresh, institute } = useAuth();
  const savedColor = useRef(institute?.brandColor);
  savedColor.current = institute?.brandColor;
  const { data } = useFetch('/admin/institute');
  const i = data?.institute;
  const [f, setF] = useState(null);
  const [color, setColor] = useState(w.settings.brandColor || '#1E3A5F');
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (i && !f) setF({ name: i.name, address: i.address, city: i.city, phone: i.phone, email: i.email }); }, [i, f]);
  // Preview the colour on the whole app while choosing; going back to the saved one if the step is left unsaved
  const tooLight = /^#[0-9a-f]{6}$/i.test(color) && whiteContrast(color) < 4.5;
  useEffect(() => { if (/^#[0-9a-f]{6}$/i.test(color) && !tooLight) applyBrandColor(color); }, [color, tooLight]);
  useEffect(() => () => applyBrandColor(savedColor.current), []);
  if (!f) return <Card title={labelOf('profile')} icon={Building2}><p className="muted">Loading...</p></Card>;
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const fe = {};
    if (!f.name.trim()) fe.name = 'Type the institute\'s name as it should appear on receipts and ID cards.';
    if (!f.address.trim()) fe.address = 'Type the address: it is printed on receipts and certificates.';
    if (!/^\+?[\d\s-]{7,18}$/.test(f.phone.trim())) fe.phone = 'Type a phone number parents can call, for example 020 2345 6789.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) fe.email = 'Type the office email, for example office@yourcollege.in.';
    setErrors(fe);
    if (Object.keys(fe).length || tooLight) return;
    setBusy(true); setErr(null);
    try {
      await api.put('/admin/institute', f);
      await api.put('/admin/setup/brand', { brandColor: color });
      await refresh();
      onDone();
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };

  return (
    <Card title={`Step 1: ${labelOf('profile')}`} icon={Building2}>
      <form onSubmit={submit} noValidate>
        <FormError error={err} />
        <div className="fields">
          <FormField label="Institute name" full required error={errors.name}><input className="input" value={f.name} onChange={set('name')} maxLength={150} /></FormField>
          <FormField label="Address" full required error={errors.address}><input className="input" value={f.address} onChange={set('address')} maxLength={300} placeholder="Building, street and area" /></FormField>
          <FormField label="City"><input className="input" value={f.city} onChange={set('city')} maxLength={80} /></FormField>
          <FormField label="Phone" required error={errors.phone}><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={20} /></FormField>
          <FormField label="Office email" full required error={errors.email} hint="Parents and staff see this as the address to write to."><input className="input" type="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={120} /></FormField>
        </div>

        <LogoPicker version={w.settings.logoVersion} onChanged={refresh} />

        <fieldset className="setup-fieldset">
          <legend className="label">Your colour</legend>
          <p className="form-hint">Buttons, the menu and the step bars use it. Choose a dark shade so white writing on it stays easy to read.</p>
          <div className="swatches" role="radiogroup" aria-label="Suggested colours">
            {SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color.toUpperCase() === c} aria-label={c}
                className={`swatch ${color.toUpperCase() === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
            <label className="swatch-custom">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#1E3A5F'} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="Pick any colour" />
              <span>Other colour</span>
            </label>
          </div>
          {tooLight && <p className="field-error" role="alert">This colour is too light: white writing on it would be hard to read. Choose a darker shade.</p>}
          <div className="brand-preview" aria-hidden="true">
            <span className="btn btn--primary btn--sm">A button</span>
            <span className="brand-preview__chip">Selected menu item</span>
          </div>
        </fieldset>
        <StepActions busy={busy} />
      </form>
    </Card>
  );
}

function LogoPicker({ version, onChanged }) {
  const input = useRef(null);
  const [v, setV] = useState(version);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setErr('Choose a PNG or JPG picture of your logo.'); return; }
    if (file.size > 300 * 1024) { setErr(`That picture is ${Math.ceil(file.size / 1024)} KB. Use one under 300 KB (a 512 x 512 PNG is plenty).`); return; }
    const fd = new FormData(); fd.append('file', file);
    setBusy(true); setErr(null);
    try { const r = await api.post('/admin/setup/logo', fd); setV(r.logoVersion); await onChanged(); } catch (ex) { setErr(ex); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async () => {
    setBusy(true); setErr(null);
    try { await api.del('/admin/setup/logo'); setV(null); await onChanged(); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <fieldset className="setup-fieldset">
      <legend className="label">Logo</legend>
      <div className="logo-pick">
        <span className="logo-pick__frame">
          {v ? <img src={`/api/me/logo?v=${v}`} alt="Your logo" /> : <ImagePlus size={26} aria-hidden="true" />}
        </span>
        <div>
          <p className="form-hint" style={{ marginBottom: 8 }}>A square PNG or JPG under 300 KB. It shows in the menu, on receipts and on ID cards.</p>
          <div className="row-actions">
            <label className="btn btn--outline btn--sm">
              <Upload size={14} aria-hidden="true" /> {busy ? 'Uploading...' : v ? 'Change logo' : 'Upload logo'}
              <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={pick} disabled={busy} />
            </label>
            {v && <button type="button" className="btn btn--outline btn--sm" onClick={remove} disabled={busy}><Trash2 size={14} aria-hidden="true" /> Remove</button>}
          </div>
        </div>
      </div>
      <FormError error={err} />
    </fieldset>
  );
}

/* ------------------------------------------------------------------ 2. Academic year */

function defaultYear() {
  const now = new Date();
  const y = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1; // Indian years start in June
  return { start: `${y}-06-01`, end: `${y + 1}-04-30` };
}

function YearStep({ w, onDone }) {
  const saved = w.settings.academicYear;
  const [f, setF] = useState(saved || { ...defaultYear(), name: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const auto = f.start && f.end ? `${f.start.slice(0, 4)}-${f.end.slice(2, 4)}` : '';
  const dateError = f.start && f.end && f.end <= f.start ? 'The last day must come after the first day.' : null;
  const submit = async (e) => {
    e.preventDefault();
    if (dateError) return;
    setBusy(true); setErr(null);
    try { await api.put('/admin/setup/year', { ...f, name: f.name || auto }); onDone(); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <Card title={`Step 2: ${labelOf('year')}`} icon={CalendarRange}>
      <form onSubmit={submit} noValidate>
        <FormError error={err} />
        <div className="fields">
          <FormField label="First day" required><input className="input" type="date" value={f.start} onChange={set('start')} /></FormField>
          <FormField label="Last day" required error={dateError}><input className="input" type="date" value={f.end} onChange={set('end')} /></FormField>
          <FormField label="Name" full hint={`Shown on fee plans and report cards. Leave empty to use ${auto || 'the years'}.`}>
            <input className="input" value={f.name} onChange={set('name')} maxLength={20} placeholder={auto} />
          </FormField>
        </div>
        <StepActions busy={busy} />
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ 3. Classes and divisions */

function ClassesStep({ w, onDone, reload }) {
  const { t } = useTenantConfig();
  const one = t('course', 'Class'); const many = t('courses', 'Classes');
  const list = useFetch('/admin/courses');
  const [f, setF] = useState({ code: '', name: '', years: 1, divisions: 'A' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const courses = (list.data?.courses || []).filter((c) => c.code !== 'SAMPLE');
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  const add = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const { course } = await api.post('/admin/courses', { code: f.code, name: f.name || f.code, years: Number(f.years) || 1 });
      if (f.divisions.trim()) await api.put(`/admin/setup/divisions/${course.id}`, { divisions: f.divisions });
      setF({ code: '', name: '', years: f.years, divisions: f.divisions });
      list.reload(); reload();
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };

  return (
    <Card title={`Step 3: ${labelOf('classes')}`} icon={School}>
      <DataTable
        caption={many} rows={list.data ? courses : null}
        columns={[
          { key: 'code', label: 'Code', render: (c) => <strong>{c.code}</strong> },
          { key: 'name', label: 'Name' },
          { key: 'years', label: 'Years', num: true },
          { key: 'div', label: 'Divisions', render: (c) => <Divisions course={c} saved={w.settings.divisions[c.id]} onSaved={reload} /> },
        ]}
        empty={{ title: `No ${many.toLowerCase()} yet`, hint: `Add your first ${one.toLowerCase()} below, for example "BSC-CS" with divisions A and B.` }}
      />
      <form onSubmit={add} className="setup-add" noValidate>
        <h3 className="setup-add__title">Add a {one.toLowerCase()}</h3>
        <FormError error={err} />
        <div className="fields">
          <FormField label="Code" required hint="Short, as on your timetable: BCA-1, CLS10"><input className="input" value={f.code} onChange={set('code')} maxLength={20} /></FormField>
          <FormField label="Name" hint="Leave empty to use the code"><input className="input" value={f.name} onChange={set('name')} maxLength={80} /></FormField>
          <FormField label="Duration (years)"><input className="input" type="number" min="1" max="8" value={f.years} onChange={set('years')} /></FormField>
          <FormField label="Divisions" hint="Separated by commas, for example A, B, C"><input className="input" value={f.divisions} onChange={set('divisions')} maxLength={120} /></FormField>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn--outline" disabled={busy || !f.code.trim()}><Plus size={15} aria-hidden="true" /> {busy ? 'Adding...' : `Add ${one.toLowerCase()}`}</button>
        </div>
      </form>
      <StepActions label="Continue" onClick={onDone} disabled={!courses.length}>
        {!courses.length && <span className="form-hint setup-why">Add at least one {one.toLowerCase()} to continue.</span>}
      </StepActions>
    </Card>
  );
}

function Divisions({ course, saved, onSaved }) {
  const [v, setV] = useState((saved || []).join(', '));
  const [state, setState] = useState('');
  const save = async () => {
    if (v === (saved || []).join(', ')) return;
    setState('saving');
    try { const r = await api.put(`/admin/setup/divisions/${course.id}`, { divisions: v }); setV(r.divisions.join(', ')); setState('saved'); onSaved(); } catch (ex) { setState(ex.message); }
  };
  return (
    <span className="divisions">
      <input className="input input--sm" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} placeholder="A, B" aria-label={`Divisions of ${course.code}`} maxLength={120} />
      {state === 'saved' && <span className="muted" role="status">Saved</span>}
      {state && !['saving', 'saved'].includes(state) && <span className="field-error" role="alert">{state}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ 4. Subjects and faculty */

function SubjectsStep({ w, onDone, reload }) {
  const { t } = useTenantConfig();
  const { toast } = useDialogs();
  const courses = useFetch('/admin/courses');
  const staff = useFetch('/admin/employees');
  const classes = (courses.data?.courses || []).filter((c) => c.code !== 'SAMPLE');
  const [f, setF] = useState({ courseId: '', name: '', teacherId: '' });
  const [teacher, setTeacher] = useState(null); // { name, email } while adding a new teacher
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!f.courseId && classes[0]) setF((c) => ({ ...c, courseId: classes[0].id })); }, [classes, f.courseId]);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const nameOf = (list, id, key = 'name') => list.find((x) => x.id === id)?.[key];

  const add = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      let teacherId = f.teacherId;
      if (teacher) { const r = await api.post('/admin/setup/teachers', teacher); teacherId = r.teacher.id; setTeacher(null); staff.reload(); }
      await api.post('/admin/setup/subjects', { ...f, teacherId: teacherId || null });
      setF((c) => ({ ...c, name: '', teacherId: '' })); reload();
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const remove = async (s) => { try { await api.del(`/admin/setup/subjects/${s.id}`); reload(); } catch (ex) { toast.error(ex.message); } };

  if (courses.data && !classes.length) {
    return (
      <Card title={`Step 4: ${labelOf('subjects')}`} icon={Users2}>
        <EmptyState title={`Add a ${t('course', 'class').toLowerCase()} first`} hint="Subjects are listed per class." action={{ label: `Go to ${labelOf('classes')}`, to: '/admin/setup?tab=classes' }} />
      </Card>
    );
  }
  const employees = staff.data?.employees || [];
  return (
    <Card title={`Step 4: ${labelOf('subjects')}`} icon={Users2}>
      <DataTable
        caption="Subjects" rows={courses.data ? w.settings.subjects : null}
        columns={[
          { key: 'name', label: 'Subject', render: (s) => <strong>{s.name}</strong> },
          { key: 'class', label: t('course', 'Class'), render: (s) => nameOf(classes, s.courseId, 'code') || '-' },
          { key: 'teacher', label: 'Teacher', render: (s) => nameOf(employees, s.teacherId) || <span className="muted">Not chosen yet</span> },
          { key: 'actions', label: '', actions: true, render: (s) => <button type="button" className="btn btn--outline btn--sm" aria-label={`Remove ${s.name}`} onClick={() => remove(s)}><Trash2 size={13} /></button> },
        ]}
        empty={{ title: 'No subjects yet', hint: 'Add the first subject below. Teachers can be chosen now or later.' }}
      />
      <form onSubmit={add} className="setup-add" noValidate>
        <h3 className="setup-add__title">Add a subject</h3>
        <FormError error={err} />
        <div className="fields">
          <FormField label={t('course', 'Class')} required>
            <select className="input" value={f.courseId} onChange={set('courseId')}>{classes.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select>
          </FormField>
          <FormField label="Subject" required><input className="input" value={f.name} onChange={set('name')} maxLength={80} placeholder="e.g. Mathematics" /></FormField>
          {teacher ? (
            <>
              <FormField label="New teacher's name" required><input className="input" value={teacher.name} onChange={(e) => setTeacher((x) => ({ ...x, name: e.target.value }))} maxLength={120} /></FormField>
              <FormField label="Their email" required hint="They will sign in with it."><input className="input" type="email" inputMode="email" value={teacher.email} onChange={(e) => setTeacher((x) => ({ ...x, email: e.target.value }))} maxLength={120} /></FormField>
            </>
          ) : (
            <FormField label="Teacher" hint={<button type="button" className="link-btn" onClick={() => setTeacher({ name: '', email: '' })}><UserPlus size={13} aria-hidden="true" /> Add a teacher who is not on the list</button>}>
              <select className="input" value={f.teacherId} onChange={set('teacherId')}>
                <option value="">Choose later</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.designation ? ` (${e.designation})` : ''}</option>)}
              </select>
            </FormField>
          )}
        </div>
        <div className="form-actions">
          {teacher && <button type="button" className="btn btn--outline" onClick={() => setTeacher(null)}>Cancel new teacher</button>}
          <button type="submit" className="btn btn--outline" disabled={busy || !f.name.trim() || !f.courseId}><Plus size={15} aria-hidden="true" /> {busy ? 'Adding...' : 'Add subject'}</button>
        </div>
      </form>
      <StepActions label="Continue" onClick={onDone} />
    </Card>
  );
}

/* ------------------------------------------------------------------ 5. Fee heads and plans */

function FeesStep({ w, onDone, reload }) {
  const { t } = useTenantConfig();
  const fees = useFetch(w.steps.find((s) => s.key === 'fees')?.off ? null : '/admin/fees/structures');
  const courses = useFetch('/admin/courses');
  const classes = (courses.data?.courses || []).filter((c) => c.code !== 'SAMPLE');
  const year = w.settings.academicYear?.name || '';
  const blank = () => ({ courseId: classes[0]?.id || '', name: 'Annual fees', heads: [{ label: 'Tuition fee', amount: '' }, { label: 'Exam fee', amount: '' }] });
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!f && courses.data) setF(blank()); }, [courses.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (w.steps.find((s) => s.key === 'fees')?.off) {
    return (
      <Card title={`Step 5: ${labelOf('fees')}`} icon={IndianRupee}>
        <EmptyState title="Fees are not switched on for your institute" hint="Nothing to do here. Ask PlanetU support if you want to collect fees in the app." />
        <StepActions label="Continue" onClick={onDone} />
      </Card>
    );
  }
  const setHead = (i, k) => (e) => setF((c) => ({ ...c, heads: c.heads.map((h, j) => (j === i ? { ...h, [k]: e.target.value } : h)) }));
  const total = (f?.heads || []).reduce((n, h) => n + (Number(h.amount) || 0), 0);

  const add = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const items = f.heads.filter((h) => h.label.trim() && Number(h.amount) > 0).map((h) => ({ label: h.label, amount: Number(h.amount) }));
      if (!items.length) throw new Error('Type an amount for at least one fee head.');
      await api.post('/admin/fees/structures', { courseId: f.courseId, name: f.name, academicYear: year || String(new Date().getFullYear()), items });
      setF(blank()); fees.reload(); reload();
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const plans = fees.data?.structures || null;

  return (
    <Card title={`Step 5: ${labelOf('fees')}`} icon={IndianRupee}>
      <DataTable
        caption="Fee plans" rows={plans}
        columns={[
          { key: 'name', label: 'Plan', render: (s) => <strong>{s.name}</strong> },
          { key: 'course', label: t('course', 'Class'), render: (s) => s.course || '-' },
          { key: 'year', label: 'Year', render: (s) => s.academicYear },
          { key: 'total', label: 'Total', num: true, render: (s) => inr(s.total) },
        ]}
        empty={{ title: 'No fee plans yet', hint: 'Add the fee heads of your first class below. Concessions and late fees come later, on the Fees page.' }}
      />
      {f && classes.length > 0 && (
        <form onSubmit={add} className="setup-add" noValidate>
          <h3 className="setup-add__title">Add a fee plan{year ? ` for ${year}` : ''}</h3>
          <FormError error={err} />
          <div className="fields">
            <FormField label={t('course', 'Class')} required>
              <select className="input" value={f.courseId} onChange={(e) => setF((c) => ({ ...c, courseId: e.target.value }))}>{classes.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select>
            </FormField>
            <FormField label="Plan name" required><input className="input" value={f.name} onChange={(e) => setF((c) => ({ ...c, name: e.target.value }))} maxLength={80} /></FormField>
          </div>
          <div className="fee-heads">
            {f.heads.map((h, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div className="fee-heads__row" key={i}>
                <input className="input" value={h.label} onChange={setHead(i, 'label')} aria-label={`Fee head ${i + 1}`} placeholder="Fee head" maxLength={60} />
                <input className="input num" type="number" min="0" inputMode="numeric" value={h.amount} onChange={setHead(i, 'amount')} aria-label={`Amount for ${h.label || `fee head ${i + 1}`}`} placeholder="Amount (₹)" />
                <button type="button" className="btn btn--outline btn--sm" aria-label="Remove this fee head" onClick={() => setF((c) => ({ ...c, heads: c.heads.filter((_, j) => j !== i) }))} disabled={f.heads.length === 1}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="fee-heads__foot">
              <button type="button" className="link-btn" onClick={() => setF((c) => ({ ...c, heads: [...c.heads, { label: '', amount: '' }] }))}><Plus size={13} aria-hidden="true" /> Add another fee head</button>
              <span>Total <strong>{inr(total)}</strong></span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--outline" disabled={busy || !f.courseId}><Plus size={15} aria-hidden="true" /> {busy ? 'Adding...' : 'Add fee plan'}</button>
          </div>
        </form>
      )}
      {courses.data && !classes.length && <EmptyState compact title={`Add a ${t('course', 'class').toLowerCase()} first`} hint="Fee plans are made per class." action={{ label: `Go to ${labelOf('classes')}`, to: '/admin/setup?tab=classes' }} />}
      <StepActions label="Continue" onClick={onDone} />
    </Card>
  );
}

/* ------------------------------------------------------------------ 6. Import students and staff */

function ImportStep({ w, onDone, reload }) {
  const { t } = useTenantConfig();
  const students = t('students', 'Students');
  const c = w.counts;
  return (
    <>
      <Card title={`Step 6: ${labelOf('import')}`} icon={Upload}>
        <p className="muted" style={{ marginTop: 0 }}>
          Fill in our template in Excel or Google Sheets, save it as CSV, and upload it. Every row is checked first and each problem
          is explained, so nothing is saved until the file is right.
        </p>
        <div className="import-tiles">
          <div className="import-tile">
            <div className="import-tile__head"><Users2 size={18} aria-hidden="true" /><strong>{students}</strong>{c.students > 0 ? <Badge tone="green">{c.students} in</Badge> : <Badge tone="amber">None yet</Badge>}</div>
            <p className="form-hint">Name, email and {t('course', 'class').toLowerCase()} code are required. Logins can be created at the same time.</p>
            <div className="row-actions">
              <a className="btn btn--outline btn--sm" href="/api/admin/students/import/template.csv" download><Download size={14} aria-hidden="true" /> Template</a>
              <Link className="btn btn--outline btn--sm" to="/admin/students/import?from=setup"><Upload size={14} aria-hidden="true" /> Import {students.toLowerCase()}</Link>
            </div>
          </div>
          <div className="import-tile">
            <div className="import-tile__head"><UserPlus size={18} aria-hidden="true" /><strong>Staff</strong>{c.staff > 0 ? <Badge tone="green">{c.staff} in</Badge> : <Badge tone="amber">None yet</Badge>}</div>
            <p className="form-hint">Name, email, department and designation. New departments and designations are made for you.</p>
            <div className="row-actions">
              <a className="btn btn--outline btn--sm" href="/api/admin/setup/staff-import/template.csv" download><Download size={14} aria-hidden="true" /> Template</a>
            </div>
          </div>
        </div>
      </Card>
      <StaffImport onImported={reload} />
      <Card>
        <StepActions label="Continue" onClick={onDone}>
          {!(c.students > 0 && c.staff > 0) && <span className="form-hint setup-why">You can continue now and import later.</span>}
        </StepActions>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ 7. Invite people */

function InviteStep({ w, onDone, reload }) {
  const { hasModule } = useTenantConfig();
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setErr(null);
    try { setResult(await api.post('/admin/setup/invite')); reload(); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const parents = hasModule('parent_portal');
  return (
    <Card title={`Step 7: ${labelOf('invite')}`} icon={Mail}>
      <p style={{ marginTop: 0 }}>
        Each staff member gets an email with their login ID and a link to choose a password (the link works for 7 days).
        {parents ? ' Parents whose email is on a student\'s record get the same, to follow their child.' : ''} Nobody gets a second invite.
      </p>
      <p className="muted">
        Students get theirs when you import them with logins switched on.
        {w.settings.invitedAt && ' Invites were already sent once; sending again only reaches people added since.'}
      </p>
      <FormError error={err} />
      {result && (
        <div className="setup-result" role="status">
          <p><CheckCircle2 size={16} aria-hidden="true" /> <strong>{result.staff.invited}</strong> staff invited{result.parents ? <>, <strong>{result.parents.created + result.parents.linked}</strong> parents invited</> : ''}.</p>
          {[...result.staff.skipped.map((s) => `${s.name} (${s.code}): ${s.reason}`), ...(result.parents?.skipped || []).map((s) => `Parent of ${s.studentCode}: ${s.reason}`)].slice(0, 20).map((m) => <p key={m} className="field-error">{m}</p>)}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={send} disabled={busy}><Mail size={15} aria-hidden="true" /> {busy ? 'Sending...' : 'Send invites'}</button>
        <button type="button" className="btn btn--primary" onClick={onDone}>Finish setup <ArrowRight size={15} aria-hidden="true" /></button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ sample data and the end */

function SampleData({ w, reload }) {
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const on = w.settings.sampleData;
  const flip = async () => {
    if (on && !(await confirm('Remove the sample class and its made-up students? Your own records are not touched.', { confirmLabel: 'Remove sample data' }))) return;
    setBusy(true);
    try {
      const r = await api.put('/admin/setup/sample-data', { on: !on });
      toast.success(on ? `Sample data removed (${r.removed} made-up students).` : 'Sample class added with 8 made-up students.');
      if (r.kept) toast.error(r.kept);
      reload();
    } catch (ex) { toast.error(ex.message); } finally { setBusy(false); }
  };
  return (
    <Card title="Try it with sample data" icon={FlaskConical}>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Adds a "Sample class" with 8 made-up students so you can try attendance, fees and results before your own data is in.
        It does not count as setup, and it comes out in one click.
      </p>
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={on} onChange={flip} disabled={busy} />
        <span>{busy ? 'Working...' : on ? 'Sample data is on' : 'Sample data is off'}</span>
      </label>
    </Card>
  );
}

function Finished({ w, onOpen }) {
  const { hasModule } = useTenantConfig();
  const left = w.steps.filter((s) => !s.done);
  if (left.length) {
    return (
      <Card title={`${left.length} step${left.length === 1 ? '' : 's'} still to do`} icon={Rocket}>
        <div className="checklist">
          {w.steps.map((s) => (
            <button key={s.key} type="button" className={`checklist__item ${s.done ? 'is-done' : ''}`} onClick={() => onOpen(s.key)}>
              <span className="checklist__mark" role="img" aria-label={s.done ? 'Done' : 'Not done'}><CheckCircle2 size={13} /></span>
              <span>{labelOf(s.key)}</span>
              <small className="muted">{s.summary}</small>
            </button>
          ))}
        </div>
      </Card>
    );
  }
  return (
    <Card title="Your institute is ready for its first class" icon={CheckCircle2}>
      <p style={{ marginTop: 0 }}>Every setup step is done. Next, build the weekly timetable so teachers see today's lectures, then take the first attendance.</p>
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn--outline" onClick={() => onOpen('profile')}>Review the setup</button>
        {hasModule('timetable') && <Link className="btn btn--primary" to="/admin/timetable">Build the timetable <ArrowRight size={15} aria-hidden="true" /></Link>}
        {!hasModule('timetable') && <Link className="btn btn--primary" to="/admin/dashboard">Go to the dashboard <ArrowRight size={15} aria-hidden="true" /></Link>}
      </div>
    </Card>
  );
}

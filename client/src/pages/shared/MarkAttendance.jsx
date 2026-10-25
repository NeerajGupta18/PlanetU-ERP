import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, Lock, Pencil, Save, Send, X } from 'lucide-react';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, FormError, PageHeader } from '../../components/ui/Ui.jsx';
import StepBar from '../../components/ui/StepBar.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import QrCheckinPanel from '../../components/campus/QrCheckinPanel.jsx';
import { attendanceProcess, processSteps } from '../../config/processes.js';
import { fmtLong, fmtRange, fmtTime, todayISO } from '../../utils/dates.js';

const OPTIONS = [
  { value: 'present', label: 'P', title: 'Present', icon: Check },
  { value: 'absent', label: 'A', title: 'Absent', icon: X },
  { value: 'late', label: 'L', title: 'Late (counts as attended)', icon: null },
];

/**
 * The marking sheet for one lecture on one date, in the fewest taps: tap only the students who are absent or late,
 * then Review (everyone not tapped becomes Present) and Submit. After submitting, the teacher goes straight on to
 * their next lecture of the day. Shared by faculty (`role="employee"`, always
 * today) and admins (`role="admin"`, any past date, via ?date=). The server decides who may edit;
 * this screen just reflects `editable` / `reason`.
 */
export default function MarkAttendance({ role, backTo }) {
  const { slotId } = useParams();
  const [params] = useSearchParams();
  const date = params.get('date') || todayISO();
  const { data, loading, error, reload } = useFetch(`/${role}/attendance/lecture?slotId=${slotId}&date=${date}`);

  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <Sheet key={`${data.lecture.slotId}${data.lecture.date}`} role={role} data={data} backTo={backTo} />}
    </DataBoundary>
  );
}

// Which step of the daily attendance process the sheet is on: marking, reviewing, or done (submitted)
function stepOf(process, phase) {
  const keys = processSteps(process).map((x) => x.key);
  if (phase === 'done') return { current: keys.at(-1), done: keys };
  if (phase === 'review') return { current: process === 'attendanceCollege' ? 'review' : 'submit' };
  return { current: 'mark' };
}

function Sheet({ role, data, backTo }) {
  const { lecture } = data;
  const { tenant } = useTenantConfig();
  const process = attendanceProcess(tenant?.type);
  const [saved, setSaved] = useState(data);
  const [marks, setMarks] = useState(() => Object.fromEntries(data.students.map((s) => [s.id, s.status])));
  const [phase, setPhase] = useState(data.session?.status === 'submitted' ? 'done' : 'mark');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [nextLecture, setNextLecture] = useState(undefined); // undefined: not looked up yet; null: none left today
  const { toast } = useDialogs();

  const students = saved.students;
  const editable = saved.editable;
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, none: 0 };
    students.forEach((s) => { c[marks[s.id] || 'none'] += 1; });
    return c;
  }, [students, marks]);
  const dirty = students.some((s) => (marks[s.id] || null) !== (s.status || null));
  const submitted = saved.session?.status === 'submitted';
  const named = (status) => students.filter((s) => marks[s.id] === status);

  // Don't lose a half-marked register to an accidental refresh or tab close
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Once submitted, find the teacher's next lecture still to mark today, so the next tap opens it
  useEffect(() => {
    if (phase !== 'done' || role !== 'employee' || lecture.date !== todayISO() || nextLecture !== undefined) return;
    api.get('/employee/attendance/today')
      .then((d) => setNextLecture(d.lectures.find((l) => l.slotId !== lecture.slotId && l.sessionStatus !== 'submitted') || null))
      .catch(() => setNextLecture(null));
  }, [phase, role, lecture.date, lecture.slotId, nextLecture]);

  const set = (id, status) => setMarks((m) => ({ ...m, [id]: status }));
  const setAll = (status) => setMarks(Object.fromEntries(students.map((s) => [s.id, status])));

  // Students who checked in with the QR code: bring their marks into the sheet without touching what the teacher changed
  async function loadCheckins() {
    try {
      const next = await api.get(`/${role}/attendance/lecture?slotId=${lecture.slotId}&date=${lecture.date}`);
      setMarks((cur) => Object.fromEntries(next.students.map((s) => {
        const before = saved.students.find((x) => x.id === s.id);
        const edited = (cur[s.id] || null) !== (before?.status || null);
        return [s.id, edited ? cur[s.id] : s.status];
      })));
      setSaved((p) => ({ ...p, students: next.students }));
    } catch (err) { setError(err); }
  }

  async function save(submit) {
    setBusy(true); setError(null);
    try {
      // On submit, everyone the teacher did not tap is present
      const final = submit ? Object.fromEntries(students.map((s) => [s.id, marks[s.id] || 'present'])) : marks;
      const body = {
        slotId: lecture.slotId, date: lecture.date, submit,
        marks: students.filter((s) => final[s.id]).map((s) => ({ studentId: s.id, status: final[s.id] })),
      };
      const next = await api.put(`/${role}/attendance/lecture`, body);
      setSaved(next);
      setMarks(Object.fromEntries(next.students.map((s) => [s.id, s.status])));
      if (submit) {
        setPhase('done'); setNextLecture(undefined);
        toast.success(`Attendance submitted: ${next.students.filter((x) => x.status !== 'absent').length} of ${next.students.length} attended.`);
      } else toast.success('Draft saved. Students will see it once you submit.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      icon={ClipboardCheck} title={lecture.subject}
      subtitle={`${lecture.course} · ${fmtLong(lecture.date)} · ${fmtRange(lecture.start, lecture.end)}`}
      back={{ to: backTo, label: role === 'employee' ? "Today's lectures" : 'Attendance' }}
    />
  );
  const bar = (
    <StepBar
      process={process} {...stepOf(process, phase)}
      waitingOn={phase === 'done' ? undefined : lecture.reassigned ? lecture.facultyName : role === 'employee' ? 'You' : lecture.facultyName}
      next={phase === 'mark' && editable ? { hint: 'Tap only the students who are absent or late. Everyone else will be marked present.' } : undefined}
    />
  );

  /* ---------- review: who is absent and late, and how many become present ---------- */
  if (phase === 'review') {
    const absent = named('absent'); const late = named('late');
    return (
      <>
        {header}{bar}
        <Card title="Review before you submit">
          <dl className="review-list">
            <div><dt className="mark-summary__p">Present</dt><dd>{counts.present + counts.none}{counts.none > 0 && <small className="muted"> ({counts.none} not tapped, marked present)</small>}</dd></div>
            <div><dt className="mark-summary__l">Late</dt><dd>{late.length ? late.map((s) => s.name).join(', ') : 'None'}</dd></div>
            <div><dt className="mark-summary__a">Absent</dt><dd>{absent.length ? absent.map((s) => s.name).join(', ') : 'None'}</dd></div>
          </dl>
          {absent.length > 0 && <p className="note">Absent students and their parents get a message as soon as you submit.</p>}
          <FormError error={error} />
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={() => setPhase('mark')} disabled={busy}><ArrowLeft size={15} /> Back to marking</button>
            <button type="button" className="btn btn--primary" onClick={() => save(true)} disabled={busy}><Send size={15} /> {busy ? 'Submitting...' : submitted ? 'Save changes' : 'Submit attendance'}</button>
          </div>
        </Card>
      </>
    );
  }

  /* ---------- done: what was submitted, and the next lecture ---------- */
  if (phase === 'done') {
    const attended = students.filter((s) => s.status === 'present' || s.status === 'late').length;
    return (
      <>
        {header}{bar}
        <Card>
          <div className="done-panel">
            <CheckCircle2 size={34} className="done-panel__icon" aria-hidden="true" />
            <div>
              <strong>Attendance submitted</strong>
              <p className="muted">{attended} of {students.length} attended{named('absent').length ? ` · absent: ${named('absent').map((s) => s.name).join(', ')}` : ' · nobody absent'}</p>
            </div>
          </div>
          <div className="form-actions">
            {editable && <button type="button" className="btn btn--outline" onClick={() => setPhase('mark')}><Pencil size={15} /> Change marks</button>}
            {nextLecture
              ? <Link className="btn btn--primary" to={`/employee/attendance/${nextLecture.slotId}`}>Next: {nextLecture.subject}, {fmtTime(nextLecture.start)} <ArrowRight size={15} /></Link>
              : <Link className="btn btn--primary" to={backTo}>{role === 'employee' && nextLecture === null ? 'All marked for today' : 'Back to the list'} <ArrowRight size={15} /></Link>}
          </div>
        </Card>
      </>
    );
  }

  /* ---------- mark ---------- */
  return (
    <>
      {header}{bar}

      {lecture.daily && <p className="note" style={{ marginTop: 0 }}>This is the daily class register. It is taken once a day by the class teacher, and it counts for the whole day.</p>}
      {role === 'employee' && !lecture.daily && editable && !submitted && lecture.date === todayISO() && <QrCheckinPanel slotId={lecture.slotId} onCheckedIn={loadCheckins} />}

      <Card
        title={`${students.length} students`}
        action={(
          <div className="badges">
            {submitted ? <Badge tone="green">Submitted</Badge> : saved.session ? <Badge tone="amber">Draft</Badge> : <Badge tone="gray">Not marked</Badge>}
            {lecture.reassigned && <Badge tone="purple">Reassigned to {lecture.facultyName}</Badge>}
          </div>
        )}
      >
        {!editable && (
          <p className="form-error" role="status"><Lock size={13} style={{ verticalAlign: '-2px' }} /> {saved.reason} You can view this sheet but not change it.</p>
        )}

        {editable && (
          <div className="toolbar">
            <div className="toolbar__filters">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setAll('present')}>Mark all present</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setAll('absent')}>Mark all absent</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setAll(null)} disabled={counts.none === students.length}>Clear</button>
            </div>
          </div>
        )}

        <div className="table-wrap" data-noscroll>
          <table className="table mark-table">
            <thead><tr><th>Roll no.</th><th>Student</th><th style={{ width: 190 }}>Attendance <span className="muted mark-table__key">(P present, A absent, L late)</span></th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className={marks[s.id] === 'absent' ? 'is-absent' : marks[s.id] === 'late' ? 'is-late' : undefined}>
                  <td className="muted">{s.rollNo || '-'}</td>
                  <td><strong>{s.name}</strong> <span className="muted">({s.code})</span>{s.rollNo && <div className="muted mark-table__roll">Roll no. {s.rollNo}</div>}</td>
                  <td>
                    <div className="mark-toggle" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
                      {OPTIONS.map((o) => (
                        <button
                          key={o.value} type="button" role="radio" aria-checked={marks[s.id] === o.value} title={o.title} aria-label={o.title}
                          disabled={!editable} className={`mark-toggle__btn mark-toggle__btn--${o.value} ${marks[s.id] === o.value ? 'is-on' : ''}`}
                          onClick={() => set(s.id, marks[s.id] === o.value ? null : o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FormError error={error} />

        {editable && (
          <div className="mark-footer">
            <div className="mark-summary" aria-live="polite">
              <span className="mark-summary__a">{counts.absent} absent</span>
              <span className="mark-summary__l">{counts.late} late</span>
              <span className="mark-summary__p">{counts.present + counts.none} present{counts.none ? ` (${counts.none} not tapped)` : ''}</span>
            </div>
            <div className="mark-footer__actions">
              {!submitted && (
                <button type="button" className="btn btn--outline" disabled={busy || !dirty} onClick={() => save(false)}>
                  <Save size={15} /> Save draft
                </button>
              )}
              {submitted && <button type="button" className="btn btn--outline" onClick={() => { setMarks(Object.fromEntries(students.map((s) => [s.id, s.status]))); setPhase('done'); }}>Cancel</button>}
              <button type="button" className="btn btn--primary" disabled={busy || !students.length || (submitted && !dirty)} onClick={() => { setError(null); setPhase('review'); }}>
                Review and submit <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

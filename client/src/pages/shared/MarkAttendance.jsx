import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ClipboardCheck, Lock, Save, Send, X } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { fmtLong, fmtRange, todayISO } from '../../utils/dates.js';

const OPTIONS = [
  { value: 'present', label: 'P', title: 'Present', icon: Check },
  { value: 'absent', label: 'A', title: 'Absent', icon: X },
  { value: 'late', label: 'L', title: 'Late (counts as attended)', icon: null },
];

/**
 * The marking sheet for one lecture on one date. Shared by faculty (`role="employee"`, always
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

function Sheet({ role, data, backTo }) {
  const { lecture } = data;
  const [saved, setSaved] = useState(data);
  const [marks, setMarks] = useState(() => Object.fromEntries(data.students.map((s) => [s.id, s.status])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const students = saved.students;
  const editable = saved.editable;
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, none: 0 };
    students.forEach((s) => { c[marks[s.id] || 'none'] += 1; });
    return c;
  }, [students, marks]);
  const dirty = students.some((s) => (marks[s.id] || null) !== (s.status || null));
  const submitted = saved.session?.status === 'submitted';

  // Don't lose a half-marked register to an accidental refresh or tab close
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (id, status) => { setNotice(''); setMarks((m) => ({ ...m, [id]: status })); };
  const setAll = (status) => { setNotice(''); setMarks(Object.fromEntries(students.map((s) => [s.id, status]))); };

  async function save(submit) {
    setBusy(true); setError(''); setNotice('');
    try {
      const body = {
        slotId: lecture.slotId, date: lecture.date, submit,
        marks: students.filter((s) => marks[s.id]).map((s) => ({ studentId: s.id, status: marks[s.id] })),
      };
      const next = await api.put(`/${role}/attendance/lecture`, body);
      setSaved(next);
      setMarks(Object.fromEntries(next.students.map((s) => [s.id, s.status])));
      setNotice(submit ? 'Attendance submitted.' : 'Draft saved. Students will see it once you submit.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageBanner
        icon={ClipboardCheck} title={lecture.subject}
        subtitle={`${lecture.course} · ${fmtLong(lecture.date)} · ${fmtRange(lecture.start, lecture.end)}`}
        actions={<Link to={backTo} className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Back</Link>}
      />

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
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setAll(null)}>Clear</button>
            </div>
            <div className="mark-summary" aria-live="polite">
              <span className="mark-summary__p">{counts.present} present</span>
              <span className="mark-summary__l">{counts.late} late</span>
              <span className="mark-summary__a">{counts.absent} absent</span>
              <span className="muted">{counts.none} unmarked</span>
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Roll no.</th><th>Student</th><th style={{ width: 190 }}>Attendance</th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="muted">{s.rollNo || '-'}</td>
                  <td><strong>{s.name}</strong> <span className="muted">({s.code})</span></td>
                  <td>
                    <div className="mark-toggle" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
                      {OPTIONS.map((o) => (
                        <button
                          key={o.value} type="button" role="radio" aria-checked={marks[s.id] === o.value} title={o.title}
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

        {error && <p className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        {notice && <p className="note" role="status">{notice}</p>}

        {editable && (
          <div className="form-actions">
            {!submitted && (
              <button type="button" className="btn btn--outline" disabled={busy || !dirty} onClick={() => save(false)}>
                <Save size={15} /> Save draft
              </button>
            )}
            <button type="button" className="btn btn--primary" disabled={busy || (submitted && !dirty) || counts.none > 0} onClick={() => save(true)}>
              <Send size={15} /> {submitted ? 'Save changes' : 'Submit attendance'}
            </button>
          </div>
        )}
        {editable && counts.none > 0 && <p className="note">Every student must be marked before you can submit.</p>}
      </Card>
    </>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Download, FileSpreadsheet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import LectureList from '../../components/attendance/LectureList.jsx';
import { fmtLong, todayISO } from '../../utils/dates.js';

const tone = (pct) => (pct >= 85 ? 'green' : pct >= 75 ? 'amber' : 'red');

export default function Attendance() {
  const [tab, setTab] = useState('day');
  const filters = useFetch('/admin/timetable/filters');
  const courses = filters.data?.courses || [];

  return (
    <>
      <PageBanner icon={ClipboardCheck} title="Attendance" subtitle="See what has been marked, correct a register, and report on attendance" />
      <Card>
        <Tabs tabs={[{ id: 'day', label: 'Daily sheet' }, { id: 'report', label: 'Reports' }]} active={tab} onChange={setTab} />
        {tab === 'day' ? <DaySheet courses={courses} /> : <Report courses={courses} />}
      </Card>
    </>
  );
}

function CourseSelect({ courses, value, onChange }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Course" style={{ width: 'auto' }}>
      <option value="">All courses</option>
      {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function DaySheet({ courses }) {
  const [date, setDate] = useState(todayISO());
  const [courseId, setCourseId] = useState('');
  const q = new URLSearchParams({ date });
  if (courseId) q.set('courseId', courseId);
  const { data, loading, error, reload } = useFetch(`/admin/attendance/day?${q}`);
  const pending = data ? data.lectures.filter((l) => l.sessionStatus !== 'submitted').length : 0;

  return (
    <>
      <div className="toolbar">
        <div className="toolbar__filters">
          <input type="date" className="input" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" style={{ width: 'auto' }} />
          <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
        </div>
        {data && !data.holiday && <span className="muted">{fmtLong(date)} · {pending} of {data.lectures.length} not yet submitted</span>}
      </div>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && <LectureList lectures={data.lectures} holiday={data.holiday} showFaculty markTo={(l) => `/admin/attendance/${l.slotId}?date=${date}`} />}
      </DataBoundary>
    </>
  );
}

function Report({ courses }) {
  const [f, setF] = useState({ courseId: '', from: '', to: '', below: '' });
  const set = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));
  const query = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, v); });
    return q.toString();
  }, [f]);
  const { data, loading, error, reload } = useFetch(`/admin/attendance/report?${query}`);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar__filters">
          <CourseSelect courses={courses} value={f.courseId} onChange={set('courseId')} />
          <input type="date" className="input" value={f.from} onChange={(e) => set('from')(e.target.value)} aria-label="From date" style={{ width: 'auto' }} />
          <input type="date" className="input" value={f.to} onChange={(e) => set('to')(e.target.value)} aria-label="To date" style={{ width: 'auto' }} />
          <input
            type="number" min="0" max="100" className="input" placeholder="Below %" value={f.below}
            onChange={(e) => set('below')(e.target.value)} aria-label="Show students below this percentage" style={{ width: 120 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn--outline btn--sm" to={`/admin/reports?report=attendance${f.courseId ? `&courseId=${f.courseId}` : ''}${f.from ? `&from=${f.from}` : ''}${f.to ? `&to=${f.to}` : ''}${f.below ? `&below=${f.below}` : ''}`}><FileSpreadsheet size={13} /> Excel / PDF</Link>
          <a className="btn btn--outline btn--sm" href={`/api/admin/attendance/report.csv?${query}`} download><Download size={13} /> Export CSV</a>
        </div>
      </div>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.students.length === 0 ? (
          <EmptyState title="No attendance to report" hint="Only submitted registers are counted. Try widening the dates or removing the percentage filter." />
        ) : (
          <>
            <p className="note" style={{ marginTop: 0 }}>Based on {data.sessions} submitted register{data.sessions === 1 ? '' : 's'}. Late counts as attended.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Roll no.</th><th>Student</th><th>Course</th><th>Attended</th><th>Overall</th><th>By subject</th></tr></thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.studentId}>
                      <td className="muted">{s.rollNo || '-'}</td>
                      <td><strong>{s.name}</strong> <span className="muted">({s.code})</span></td>
                      <td>{s.course}</td>
                      <td>{s.attended} / {s.total}</td>
                      <td><Badge tone={tone(s.pct)}>{s.pct}%</Badge></td>
                      <td>
                        <div className="badges">
                          {s.subjects.map((x) => <Badge key={x.subject} tone={tone(x.pct)}>{x.subject}: {x.pct}%</Badge>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
      </DataBoundary>
    </>
  );
}

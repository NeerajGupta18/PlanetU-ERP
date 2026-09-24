import { useMemo, useState } from 'react';
import {
  CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Flag, GraduationCap, LayoutList, ListChecks, Lock, MapPin, Presentation, RotateCcw, Table2, User, Video, BookOpen, Clock, Building,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import {
  addDays, addMonths, endOfMonth, fmtDay, fmtLong, fmtRange, isToday, MONTHS, parseISO, startOfMonth, startOfWeek, toISO, todayISO, WEEKDAYS_SHORT,
} from '../../utils/dates.js';

const VIEWS = [
  { id: 'day', label: 'Day View', icon: CalendarDays },
  { id: 'week', label: 'Week View', icon: CalendarRange },
  { id: 'month', label: 'Month View', icon: Table2 },
  { id: 'list', label: 'List View', icon: LayoutList },
];
const PRIORITY_TONE = { High: 'red', Medium: 'amber', Low: 'green' };
const EMPTY_FILTERS = { department: '', employeeId: '', subject: '', priority: '' };

const defaultRange = () => ({ start: todayISO(), end: toISO(addDays(new Date(), 6)) });

function rangeFor(view, anchor, current) {
  const a = parseISO(anchor);
  if (view === 'day') return { start: anchor, end: anchor };
  if (view === 'week') { const s = startOfWeek(a); return { start: toISO(s), end: toISO(addDays(s, 6)) }; }
  if (view === 'month') return { start: toISO(startOfMonth(a)), end: toISO(endOfMonth(a)) };
  return current;
}

export default function Timetable() {
  const [view, setView] = useState('list');
  const [anchor, setAnchor] = useState(todayISO());
  const [range, setRange] = useState(defaultRange);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const query = useMemo(() => {
    const q = new URLSearchParams({ start: range.start, end: range.end });
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v); });
    return q.toString();
  }, [range, filters]);
  const { data, loading, error, reload } = useFetch(`/student/timetable?${query}`);

  const changeView = (next, nextAnchor = anchor) => {
    setView(next);
    setAnchor(nextAnchor);
    setRange((cur) => rangeFor(next, nextAnchor, cur));
  };

  const step = (dir) => {
    const a = parseISO(anchor);
    const next = view === 'day' ? addDays(a, dir) : view === 'week' ? addDays(a, 7 * dir) : addMonths(a, dir);
    changeView(view, toISO(next));
  };

  const onDate = (key, value) => {
    if (!value) return;
    const next = { ...range, [key]: value };
    if (next.end < next.start) { if (key === 'start') next.end = value; else next.start = value; }
    setRange(next);
    setView('list');
  };

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const reset = () => { setFilters(EMPTY_FILTERS); setView('list'); setAnchor(todayISO()); setRange(defaultRange()); };

  const opts = data?.filters;
  const items = data?.items || [];

  const navLabel = view === 'day' ? fmtLong(anchor)
    : view === 'week' ? `${fmtDay(range.start)} - ${fmtDay(range.end)}`
      : `${MONTHS[parseISO(anchor).getMonth()]} ${parseISO(anchor).getFullYear()}`;

  return (
    <>
      <PageBanner
        icon={Table2} title="Timetable" subtitle="Your lectures and duties, day by day"
        actions={(
          <div className="segmented" role="tablist" aria-label="Timetable view">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={`segmented__item ${view === id ? 'is-active' : ''}`} onClick={() => changeView(id)}>
                <Icon size={14} /> <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      />

      <section className="card filters">
        <div className="filters__grid">
          <label className="filter">
            <span><Building size={13} /> Department</span>
            <select value={filters.department} onChange={setFilter('department')}>
              <option value="">All Departments</option>
              {opts?.departments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="filter">
            <span><User size={13} /> Employee</span>
            <select value={filters.employeeId} onChange={setFilter('employeeId')}>
              <option value="">All Employees</option>
              {opts?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="filter">
            <span><GraduationCap size={13} /> Course/Class <Lock size={11} className="filter__lock" /></span>
            <select value={opts?.course.id || ''} disabled title="Your timetable is limited to your own course">
              <option value={opts?.course.id || ''}>{opts?.course.name || 'My course'}</option>
            </select>
          </label>
          <label className="filter">
            <span><BookOpen size={13} /> Subject</span>
            <select value={filters.subject} onChange={setFilter('subject')}>
              <option value="">All Subjects</option>
              {opts?.subjects.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="filter">
            <span><CalendarDays size={13} /> Start Date</span>
            <input type="date" value={range.start} onChange={(e) => onDate('start', e.target.value)} />
          </label>
          <label className="filter">
            <span><CalendarDays size={13} /> End Date</span>
            <input type="date" value={range.end} onChange={(e) => onDate('end', e.target.value)} />
          </label>
          <label className="filter">
            <span><Flag size={13} /> Priority (Duties)</span>
            <select value={filters.priority} onChange={setFilter('priority')}>
              <option value="">All Priorities</option>
              {opts?.priorities.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <div className="filter filter--action">
            <button type="button" className="btn btn--outline btn--block" onClick={reset}><RotateCcw size={14} /> Reset</button>
          </div>
        </div>
      </section>

      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <div className="summary">
              <span><BookOpen size={15} /> <strong>{data.summary.lectures}</strong> Lectures</span>
              <span><ListChecks size={15} /> <strong>{data.summary.duties}</strong> Duties</span>
              <span><Clock size={15} /> <strong>{data.summary.timeSlots}</strong> Time Slots</span>
              <span><CalendarDays size={15} /> {data.summary.start} to {data.summary.end}</span>
            </div>

            {view !== 'list' && (
              <div className="tt-nav">
                <button type="button" className="icon-btn icon-btn--bordered" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
                <strong>{navLabel}</strong>
                <button type="button" className="icon-btn icon-btn--bordered" onClick={() => step(1)} aria-label="Next"><ChevronRight size={18} /></button>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => changeView(view, todayISO())}>Today</button>
              </div>
            )}

            <div className={loading ? 'is-loading' : ''}>
              {view === 'list' && <ListView items={items} />}
              {view === 'day' && <DayView items={items} />}
              {view === 'week' && <WeekView items={items} start={range.start} />}
              {view === 'month' && <MonthView items={items} anchor={anchor} onPick={(iso) => changeView('day', iso)} />}
            </div>
          </>
        )}
      </DataBoundary>
    </>
  );
}

/* ---------- shared bits ---------- */
function TypeBadges({ item }) {
  return (
    <div className="badges">
      <Badge tone={item.type === 'lecture' ? 'blue' : 'amber'}>{item.type === 'lecture' ? 'Lecture' : 'Duty'}</Badge>
      {item.mode && <Badge tone={item.mode === 'Online' ? 'cyan' : 'gray'}>{item.mode}</Badge>}
      {item.priority && <Badge tone={PRIORITY_TONE[item.priority]}>{item.priority}</Badge>}
    </div>
  );
}
const Reassigned = ({ item }) => item.reassignedTo && <Badge tone="purple" className="badge--wide">Reassigned to {item.reassignedTo}</Badge>;
const Where = ({ item }) => (
  <span className="where">{item.mode === 'Online' ? <Video size={12} /> : <MapPin size={12} />} {item.location}</span>
);
const noItems = <EmptyState title="No lectures or duties found" hint="Try a different date range or clear the filters." />;

/* ---------- List ---------- */
function ListView({ items }) {
  if (!items.length) return noItems;
  return (
    <div className="table-wrap tt-table">
      <table className="table">
        <thead>
          <tr><th>Type</th><th>Date</th><th>Time</th><th>Title/Subject</th><th>Faculty/Employee</th><th>Department</th><th>Course</th><th>Location</th></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className={isToday(i.date) ? 'is-today' : ''}>
              <td><TypeBadges item={i} /><Reassigned item={i} /></td>
              <td className="nowrap">{i.date} {isToday(i.date) && <Badge tone="green">TODAY</Badge>}</td>
              <td className="nowrap">{fmtRange(i.start, i.end)}</td>
              <td><strong>{i.title}</strong></td>
              <td>
                <div className="person">
                  <strong>{i.employee.name}</strong>
                  <small>{i.employee.designation}</small>
                  <small>Shift: {i.employee.shift}</small>
                </div>
              </td>
              <td>{i.department}</td>
              <td>{i.course}</td>
              <td>{i.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Day ---------- */
function DayView({ items }) {
  if (!items.length) return noItems;
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={i.id} className="timeline__item">
          <div className="timeline__time"><strong>{fmtRange(i.start, i.end).split(' - ')[0]}</strong><small>{fmtRange(i.start, i.end).split(' - ')[1]}</small></div>
          <div className={`tt-card tt-card--${i.type}`}>
            <div className="tt-card__top"><strong>{i.title}</strong><TypeBadges item={i} /></div>
            <div className="tt-card__meta">
              <span><User size={12} /> {i.employee.name}, {i.employee.designation}</span>
              <Where item={i} />
              <span><Presentation size={12} /> {i.department}</span>
            </div>
            <Reassigned item={i} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Week ---------- */
function WeekView({ items, start }) {
  const days = Array.from({ length: 7 }, (_, n) => toISO(addDays(parseISO(start), n)));
  if (!items.length) return noItems;
  return (
    <div className="week">
      {days.map((iso) => {
        const list = items.filter((i) => i.date === iso);
        return (
          <section key={iso} className={`week__col ${isToday(iso) ? 'is-today' : ''}`}>
            <h3>{fmtDay(iso)} {isToday(iso) && <Badge tone="green">TODAY</Badge>}</h3>
            {list.length === 0 && <p className="week__empty">No classes</p>}
            {list.map((i) => (
              <div key={i.id} className={`tt-card tt-card--${i.type} tt-card--compact`}>
                <strong>{i.title}</strong>
                <small className="nowrap">{fmtRange(i.start, i.end)}</small>
                <small>{i.employee.name}</small>
                <Where item={i} />
                <Reassigned item={i} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- Month ---------- */
function MonthView({ items, anchor, onPick }) {
  const a = parseISO(anchor);
  const first = startOfMonth(a);
  const total = endOfMonth(a).getDate();
  const lead = first.getDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, n) => toISO(addDays(first, n)))];
  return (
    <div className="mcal">
      <div className="cal__weekdays">{WEEKDAYS_SHORT.map((d) => <div key={d}>{d}</div>)}</div>
      <div className="cal__grid">
        {cells.map((iso, idx) => {
          if (!iso) return <div key={`b${idx}`} className="cal__day is-outside is-blank" />;
          const list = items.filter((i) => i.date === iso);
          const lectures = list.filter((i) => i.type === 'lecture').length;
          const duties = list.length - lectures;
          return (
            <button key={iso} type="button" className={`cal__day ${isToday(iso) ? 'is-today' : ''}`} onClick={() => onPick(iso)} aria-label={`${fmtLong(iso)}: ${lectures} lectures, ${duties} duties`}>
              <span className="cal__num">{Number(iso.slice(8))}</span>
              <span className="cal__chips">
                {lectures > 0 && <span className="chip chip--blue">{lectures} lecture{lectures > 1 ? 's' : ''}</span>}
                {duties > 0 && <span className="chip chip--amber">{duties} dut{duties > 1 ? 'ies' : 'y'}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

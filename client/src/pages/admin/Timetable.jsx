import { useMemo, useState } from 'react';
import {
  ArrowLeftRight, Building, CalendarDays, Pencil, Plus, RotateCcw, Table2, Trash2, User, Video, MapPin,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { addDays, fmtRange, isToday, toISO, todayISO, WEEKDAYS_SHORT } from '../../utils/dates.js';

const TABS = [
  { id: 'schedule', label: 'Lecture Reassignment' },
  { id: 'slots', label: 'Weekly Slots' },
];
const EMPTY_FILTERS = { department: '', employeeId: '' };

export default function Timetable() {
  const [tab, setTab] = useState('schedule');
  const [range, setRange] = useState(() => ({ start: todayISO(), end: toISO(addDays(new Date(), 6)) }));
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const filterOpts = useFetch('/admin/timetable/filters');

  const query = useMemo(() => {
    const q = new URLSearchParams({ start: range.start, end: range.end });
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v); });
    return q.toString();
  }, [range, filters]);
  const schedule = useFetch(`/admin/timetable?${query}`);
  const slots = useFetch('/admin/timetable/slots');

  const [reassignItem, setReassignItem] = useState(null);
  const [slotModal, setSlotModal] = useState(null);

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const setDate = (key) => (e) => setRange((r) => ({ ...r, [key]: e.target.value }));
  const reset = () => { setFilters(EMPTY_FILTERS); setRange({ start: todayISO(), end: toISO(addDays(new Date(), 6)) }); };

  const departments = filterOpts.data?.departments || [];
  const employees = filterOpts.data?.employees || [];
  const courses = filterOpts.data?.courses || [];

  return (
    <>
      <PageBanner
        icon={Table2} title="Timetable" subtitle="Scheduled lectures and duties - reassign to another available employee when needed"
        actions={tab === 'slots' ? (
          <button type="button" className="btn btn--primary" onClick={() => setSlotModal({ id: null })}><Plus size={15} /> Add Weekly Lecture</button>
        ) : undefined}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'schedule' && (
        <>
          <section className="card filters">
            <div className="filters__grid">
              <label className="filter">
                <span><Building size={13} /> Department</span>
                <select value={filters.department} onChange={setFilter('department')}>
                  <option value="">All Departments</option>
                  {departments.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="filter">
                <span><User size={13} /> Employee</span>
                <select value={filters.employeeId} onChange={setFilter('employeeId')}>
                  <option value="">All Employees</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label className="filter">
                <span><CalendarDays size={13} /> Start Date</span>
                <input type="date" value={range.start} onChange={setDate('start')} />
              </label>
              <label className="filter">
                <span><CalendarDays size={13} /> End Date</span>
                <input type="date" value={range.end} onChange={setDate('end')} />
              </label>
              <div className="filter filter--action">
                <button type="button" className="btn btn--outline btn--block" onClick={reset}><RotateCcw size={14} /> Reset</button>
              </div>
            </div>
          </section>

          <DataBoundary loading={schedule.loading} error={schedule.error} data={schedule.data} reload={schedule.reload}>
            {schedule.data && (
              <>
                <div className="summary">
                  <span><strong>{schedule.data.summary.lectures}</strong> Lectures</span>
                  <span><strong>{schedule.data.summary.duties}</strong> Duties</span>
                  <span><strong>{schedule.data.summary.timeSlots}</strong> Time Slots</span>
                  <span><CalendarDays size={15} /> {schedule.data.summary.start} to {schedule.data.summary.end}</span>
                </div>

                {schedule.data.items.length === 0 ? <EmptyState title="No lectures or duties found" hint="Try a different date range or clear the filters." /> : (
                  <div className="table-wrap tt-table">
                    <table className="table">
                      <thead><tr><th>Type</th><th>Date</th><th>Time</th><th>Subject</th><th>Faculty/Employee</th><th>Department</th><th>Mode</th><th>Actions</th></tr></thead>
                      <tbody>
                        {schedule.data.items.map((i) => (
                          <tr key={i.id} className={isToday(i.date) ? 'is-today' : ''}>
                            <td>
                              <Badge tone={i.type === 'lecture' ? 'blue' : 'amber'}>{i.type === 'lecture' ? 'Lecture' : 'Duty'}</Badge>
                              {i.mode && <Badge tone={i.mode === 'Online' ? 'cyan' : 'gray'} className="badge--wide">{i.mode}</Badge>}
                              {i.reassignedTo && <Badge tone="purple" className="badge--wide">Reassigned to {i.reassignedTo.name}</Badge>}
                            </td>
                            <td className="nowrap">{i.date} {isToday(i.date) && <Badge tone="green">TODAY</Badge>}</td>
                            <td className="nowrap">{fmtRange(i.start, i.end)}</td>
                            <td><strong>{i.title}</strong></td>
                            <td>
                              <div className="person">
                                <strong>{(i.reassignedTo || i.employee).name}</strong>
                                <small>{(i.reassignedTo || i.employee).designation}</small>
                              </div>
                            </td>
                            <td>{i.department}</td>
                            <td><span className="where">{i.mode === 'Online' ? <Video size={12} /> : <MapPin size={12} />} {i.location}</span></td>
                            <td>
                              {i.type === 'lecture' && (
                                <div className="row-actions">
                                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setReassignItem(i)}><ArrowLeftRight size={13} /> Reassign</button>
                                  {i.reassignedTo && (
                                    <button
                                      type="button" className="btn btn--outline btn--sm"
                                      onClick={async () => { await api.put('/admin/timetable/reassign/undo', { slotId: i.slotId, date: i.date }); schedule.reload(); }}
                                    >
                                      Undo
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </DataBoundary>
        </>
      )}

      {tab === 'slots' && (
        <Card title="Weekly lecture template" icon={Table2}>
          <DataBoundary loading={slots.loading} error={slots.error} data={slots.data} reload={slots.reload}>
            {slots.data && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Weekday</th><th>Time</th><th>Subject</th><th>Faculty</th><th>Course</th><th>Mode</th><th>Location</th><th>Actions</th></tr></thead>
                  <tbody>
                    {slots.data.slots.map((s) => (
                      <tr key={s.id}>
                        <td>{WEEKDAYS_SHORT[s.weekday]}</td>
                        <td className="nowrap">{fmtRange(s.start, s.end)}</td>
                        <td><strong>{s.subject}</strong></td>
                        <td>{s.employeeName}</td>
                        <td>{s.courseName}</td>
                        <td><Badge tone={s.mode === 'Online' ? 'cyan' : 'gray'}>{s.mode}</Badge></td>
                        <td className="muted">{s.location}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn--outline btn--sm" onClick={() => setSlotModal(s)}><Pencil size={13} /></button>
                            <button
                              type="button" className="btn btn--outline btn--sm"
                              onClick={async () => {
                                if (!confirm(`Delete the "${s.subject}" slot?`)) return;
                                await api.del(`/admin/timetable/slots/${s.id}`);
                                slots.reload();
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DataBoundary>
        </Card>
      )}

      <ReassignModal item={reassignItem} employees={employees} onClose={() => setReassignItem(null)} onSaved={schedule.reload} />
      <SlotModal state={slotModal} courses={courses} employees={employees} onClose={() => setSlotModal(null)} onSaved={() => { slots.reload(); schedule.reload(); }} />
    </>
  );
}

function ReassignModal({ item, employees, onClose, onSaved }) {
  const open = !!item;
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [seededFor, setSeededFor] = useState(null);

  if (open && seededFor !== item.id) {
    setSeededFor(item.id);
    setEmployeeId('');
    setReason('');
    setError(null);
  }

  const others = employees.filter((e) => e.id !== item?.employee?.id);

  const submit = async (e) => {
    e.preventDefault();
    if (!employeeId) { setError('Choose an employee to reassign to.'); return; }
    setBusy(true); setError(null);
    try {
      await api.put('/admin/timetable/reassign', { slotId: item.slotId, date: item.date, toEmployeeId: employeeId, reason });
      onSaved(); onClose(); setEmployeeId(''); setReason('');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Reassign lecture" onClose={onClose}>
      {item && (
        <form onSubmit={submit}>
          {error && <p className="form-error">{error}</p>}
          <p className="muted" style={{ marginBottom: 14 }}>
            Reassigning <strong>{item.title}</strong> on {item.date} ({fmtRange(item.start, item.end)}), currently with {item.employee.name}.
          </p>
          <div className="form-field">
            <label className="label">Reassign to</label>
            <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
              <option value="">-- Select employee --</option>
              {others.map((e) => <option key={e.id} value={e.id}>{e.name} - {e.department}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Reason (optional)</label>
            <input className="input" placeholder="e.g., Faculty on leave" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm reassignment'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const emptySlot = { courseId: '', weekday: 1, start: '09:00', end: '10:00', subject: '', employeeId: '', mode: 'Offline', location: '' };

function SlotModal({ state, courses, employees, onClose, onSaved }) {
  const open = !!state;
  const isEdit = !!state?.id;
  const [form, setForm] = useState(emptySlot);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== (state.id || 'new')) {
    setForm({ ...emptySlot, ...(isEdit ? state : { courseId: courses[0]?.id || '', employeeId: employees[0]?.id || '' }), __key: state.id || 'new' });
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, id, employeeName, courseName, type, ...payload } = form;
    try {
      if (isEdit) await api.put(`/admin/timetable/slots/${state.id}`, payload);
      else await api.post('/admin/timetable/slots', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit weekly lecture' : 'Add weekly lecture'} onClose={onClose} width={540}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field">
          <label className="label">Subject</label>
          <input className="input" value={form.subject} onChange={set('subject')} required />
        </div>
        <div className="fields">
          <div className="form-field">
            <label className="label">Course</label>
            <select className="input" value={form.courseId} onChange={set('courseId')} required>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Weekday</label>
            <select className="input" value={form.weekday} onChange={(e) => setForm((f) => ({ ...f, weekday: Number(e.target.value) }))}>
              {WEEKDAYS_SHORT.map((d, idx) => <option key={d} value={idx}>{d}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Start time</label>
            <input className="input" type="time" value={form.start} onChange={set('start')} required />
          </div>
          <div className="form-field">
            <label className="label">End time</label>
            <input className="input" type="time" value={form.end} onChange={set('end')} required />
          </div>
          <div className="form-field">
            <label className="label">Faculty / Employee</label>
            <select className="input" value={form.employeeId} onChange={set('employeeId')} required>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Mode</label>
            <select className="input" value={form.mode} onChange={set('mode')}>
              <option>Offline</option><option>Online</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="label">Location</label>
          <input className="input" value={form.location} onChange={set('location')} placeholder="e.g., Room 112-A3" />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add lecture'}</button>
        </div>
      </form>
    </Modal>
  );
}

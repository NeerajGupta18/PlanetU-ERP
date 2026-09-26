import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import {
  addDays, addMonths, fmtEventDates, fmtLong, fmtRange, isToday, MONTHS, startOfMonth, toISO, todayISO, WEEKDAYS_SHORT,
} from '../../utils/dates.js';

const MAX_CHIPS = 3;

function buildGrid(cursor) {
  const first = startOfMonth(cursor);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => toISO(addDays(start, i)));
}

export default function Calendar() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(todayISO());
  const [hidden, setHidden] = useState(() => new Set());
  const [modal, setModal] = useState(null); // event object, { id: null } for add, or null closed

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const { data, loading, error, reload } = useFetch(`/admin/calendar?year=${year}&month=${month}`);

  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const events = useMemo(() => (data?.events || []).filter((e) => !hidden.has(e.type)), [data, hidden]);
  const onDay = (iso) => events.filter((e) => e.start <= iso && iso <= e.end);
  const selectedEvents = onDay(selected);

  const go = (n) => { const next = addMonths(cursor, n); setCursor(next); setSelected(toISO(next)); };
  const goToday = () => { setCursor(startOfMonth(new Date())); setSelected(todayISO()); };
  const toggleType = (t) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const removeEvent = async (e) => {
    if (!confirm(`Delete "${e.title}"?`)) return;
    await api.del(`/admin/calendar/${e.id}`);
    reload();
  };

  return (
    <>
      <PageBanner
        icon={CalendarDays} title="Academic Calendar" subtitle="Exams, events, deadlines and holidays"
        actions={<button type="button" className="btn btn--primary" onClick={() => setModal({ id: null, start: selected })}><Plus size={15} /> Add Event</button>}
      />

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="icon-btn icon-btn--bordered" onClick={() => go(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <h2 className="cal-title">{MONTHS[cursor.getMonth()]} {year}</h2>
          <button type="button" className="icon-btn icon-btn--bordered" onClick={() => go(1)} aria-label="Next month"><ChevronRight size={18} /></button>
          <button type="button" className="btn btn--outline btn--sm" onClick={goToday}>Today</button>
        </div>
        <div className="legend" role="group" aria-label="Filter by type">
          {Object.entries(EVENT_TYPES).map(([key, t]) => (
            <button
              key={key} type="button" aria-pressed={!hidden.has(key)}
              className={`legend__item legend__item--${t.tone} ${hidden.has(key) ? 'is-off' : ''}`} onClick={() => toggleType(key)}
            >
              <span className="legend__dot" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        <div className="cal-layout">
          <div className={`cal ${loading ? 'is-loading' : ''}`}>
            <div className="cal__weekdays">
              {WEEKDAYS_SHORT.map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="cal__grid">
              {grid.map((iso) => {
                const inMonth = Number(iso.slice(5, 7)) === month;
                const list = onDay(iso);
                const dow = new Date(`${iso}T00:00:00`).getDay();
                return (
                  <button
                    key={iso} type="button" onClick={() => setSelected(iso)}
                    className={`cal__day ${inMonth ? '' : 'is-outside'} ${isToday(iso) ? 'is-today' : ''} ${selected === iso ? 'is-selected' : ''} ${dow === 0 ? 'is-sunday' : ''}`}
                    aria-label={`${fmtLong(iso)}, ${list.length} events`}
                  >
                    <span className="cal__num">{Number(iso.slice(8))}</span>
                    <span className="cal__chips">
                      {list.slice(0, MAX_CHIPS).map((e) => (
                        <span key={e.id} className={`chip chip--${EVENT_TYPES[e.type].tone}`} title={e.title}>{e.title}</span>
                      ))}
                      {list.length > MAX_CHIPS && <span className="chip chip--more">+{list.length - MAX_CHIPS} more</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Card title={fmtLong(selected)} className="cal-side">
            {selectedEvents.length === 0 ? (
              <EmptyState title="No events on this day" hint="Pick another date, or add one for this day." />
            ) : (
              <ul className="day-events">
                {selectedEvents.map((e) => {
                  const t = EVENT_TYPES[e.type];
                  return (
                    <li key={e.id} className={`day-events__item day-events__item--${t.tone}`}>
                      <div className="day-events__head"><strong>{e.title}</strong><Badge tone={t.tone}>{t.label}</Badge></div>
                      <div className="day-events__meta">
                        <span><CalendarDays size={12} /> {fmtEventDates(e.start, e.end)}</span>
                        {e.startTime && <span><Clock size={12} /> {fmtRange(e.startTime, e.endTime)}</span>}
                        {e.location && <span><MapPin size={12} /> {e.location}</span>}
                      </div>
                      {e.description && <p>{e.description}</p>}
                      <div className="row-actions" style={{ marginTop: 10 }}>
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal(e)}><Pencil size={13} /> Edit</button>
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => removeEvent(e)}><Trash2 size={13} /> Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card title={`All events in ${MONTHS[cursor.getMonth()]}`} className="month-list">
          {events.length === 0 ? (
            <EmptyState title="No events this month" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Time</th><th>Location</th><th>Actions</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="is-clickable" onClick={() => setSelected(e.start > toISO(startOfMonth(cursor)) ? e.start : toISO(startOfMonth(cursor)))}>{fmtEventDates(e.start, e.end)}</td>
                      <td><strong>{e.title}</strong></td>
                      <td><Badge tone={EVENT_TYPES[e.type].tone}>{EVENT_TYPES[e.type].label}</Badge></td>
                      <td>{e.startTime ? fmtRange(e.startTime, e.endTime) : 'All day'}</td>
                      <td>{e.location || '-'}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal(e)}><Pencil size={13} /></button>
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => removeEvent(e)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DataBoundary>

      <EventModal state={modal} onClose={() => setModal(null)} onSaved={reload} />
    </>
  );
}

const empty = { title: '', type: 'event', start: '', end: '', allDay: true, startTime: '', endTime: '', location: '', description: '', audience: 'all' };

function EventModal({ state, onClose, onSaved }) {
  const open = !!state;
  const isEdit = !!state?.id;
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (open && form.__key !== (state.id || `new-${state.start || ''}`)) {
    setForm({ ...empty, ...(isEdit ? state : { start: state.start || '' }), __key: state.id || `new-${state.start || ''}` });
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { __key, id, ...payload } = form;
    payload.allDay = !payload.startTime;
    if (!payload.end) payload.end = payload.start;
    try {
      if (isEdit) await api.put(`/admin/calendar/${state.id}`, payload);
      else await api.post('/admin/calendar', payload);
      onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={isEdit ? 'Edit event' : 'Add event'} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="form-field">
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={set('title')} required />
        </div>
        <div className="fields">
          <div className="form-field">
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={set('type')}>
              {Object.entries(EVENT_TYPES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Audience</label>
            <select className="input" value={form.audience} onChange={set('audience')}>
              <option value="all">Everyone</option>
              <option value="student">Students</option>
            </select>
          </div>
          <div className="form-field">
            <label className="label">Start date</label>
            <input className="input" type="date" value={form.start} onChange={set('start')} required />
          </div>
          <div className="form-field">
            <label className="label">End date</label>
            <input className="input" type="date" value={form.end} onChange={set('end')} />
          </div>
          <div className="form-field">
            <label className="label">Start time (optional)</label>
            <input className="input" type="time" value={form.startTime} onChange={set('startTime')} />
          </div>
          <div className="form-field">
            <label className="label">End time (optional)</label>
            <input className="input" type="time" value={form.endTime} onChange={set('endTime')} />
          </div>
        </div>
        <div className="form-field">
          <label className="label">Location</label>
          <input className="input" value={form.location} onChange={set('location')} />
        </div>
        <div className="form-field">
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={set('description')} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add event'}</button>
        </div>
      </form>
    </Modal>
  );
}

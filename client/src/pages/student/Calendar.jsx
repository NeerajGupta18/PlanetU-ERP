import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import {
  addDays, addMonths, fmtEventDates, fmtLong, fmtRange, isToday, MONTHS, startOfMonth, toISO, todayISO, WEEKDAYS_SHORT,
} from '../../utils/dates.js';

const MAX_CHIPS = 3;

/** 6 weeks x 7 days grid (Sunday first) that always contains the whole month */
function buildGrid(cursor) {
  const first = startOfMonth(cursor);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => toISO(addDays(start, i)));
}

export default function Calendar() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(todayISO());
  const [hidden, setHidden] = useState(() => new Set());

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const { data, loading, error, reload } = useFetch(`/student/calendar?year=${year}&month=${month}`);

  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const events = useMemo(() => (data?.events || []).filter((e) => !hidden.has(e.type)), [data, hidden]);
  const onDay = (iso) => events.filter((e) => e.start <= iso && iso <= e.end);
  const selectedEvents = onDay(selected);

  const go = (n) => {
    const next = addMonths(cursor, n);
    setCursor(next);
    setSelected(toISO(next));
  };
  const goToday = () => { setCursor(startOfMonth(new Date())); setSelected(todayISO()); };
  const toggleType = (t) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <>
      <PageBanner icon={CalendarDays} title="Academic Calendar" subtitle="Exams, events, deadlines and holidays" />

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
              <EmptyState title="No events on this day" hint="Pick another date to see what is planned." />
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
                <thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Time</th><th>Location</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} onClick={() => setSelected(e.start > toISO(startOfMonth(cursor)) ? e.start : toISO(startOfMonth(cursor)))} className="is-clickable">
                      <td>{fmtEventDates(e.start, e.end)}</td>
                      <td><strong>{e.title}</strong></td>
                      <td><Badge tone={EVENT_TYPES[e.type].tone}>{EVENT_TYPES[e.type].label}</Badge></td>
                      <td>{e.startTime ? fmtRange(e.startTime, e.endTime) : 'All day'}</td>
                      <td>{e.location || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DataBoundary>
    </>
  );
}

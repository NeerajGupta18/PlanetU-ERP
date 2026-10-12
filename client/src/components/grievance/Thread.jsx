import { fmtDate } from '../../utils/dates.js';

export const STATUS_WORD = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
export const STATUS_TONE = { open: 'amber', in_progress: 'blue', resolved: 'green', closed: 'gray' };

const when = (iso) => `${fmtDate(String(iso).slice(0, 10))}, ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

/** The conversation on a ticket: the first message is the ticket's own details. `mineIsOffice` says which side "you" are. */
export default function Thread({ grievance, messages, mineIsOffice = false, firstFrom }) {
  const bubble = (key, text, fromOffice, at, who) => {
    const mine = fromOffice === mineIsOffice;
    return (
      <div key={key} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
        <div style={{ maxWidth: '85%', background: fromOffice ? '#eef2ff' : '#f4f4f8', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>{who} - {when(at)}</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{text}</div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: 'grid', gap: 8, maxHeight: 340, overflow: 'auto', padding: '4px 2px' }}>
      {bubble('first', grievance.details, false, grievance.createdAt, firstFrom)}
      {messages.map((m) => bubble(m.id, m.body, m.fromOffice, m.at, m.fromOffice ? 'Office' : firstFrom))}
    </div>
  );
}

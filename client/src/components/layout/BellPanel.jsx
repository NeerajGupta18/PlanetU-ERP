import { useNavigate } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Bell, CheckCheck, Info } from 'lucide-react';

const TONE_ICON = { bad: AlertCircle, warn: AlertTriangle, info: Info };
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** The list inside the bell: today's reminders first, then messages (unread ones marked), newest first. */
export default function BellPanel({ bell }) {
  const navigate = useNavigate();
  const open = (n) => {
    if (n.id && !n.read && !n.tone) bell.markRead(n.id);
    if (n.link) navigate(n.link);
  };
  const empty = !bell.reminders.length && !bell.items.length;
  return (
    <div className="notif" role="dialog" aria-label="Notifications">
      <div className="notif__head">
        <span>Notifications</span>
        {bell.unread > 0 && (
          <button type="button" className="notif__all" onClick={(e) => { e.stopPropagation(); bell.markAll(); }}><CheckCheck size={14} /> Mark all read</button>
        )}
      </div>
      <div className="notif__list">
        {empty && <p className="notif__empty"><Bell size={16} /> You're all caught up.</p>}
        {bell.reminders.map((r) => {
          const Icon = TONE_ICON[r.tone] || Info;
          return (
            <button type="button" key={r.id} className={`notif__item notif__item--${r.tone || 'info'}`} onClick={() => open(r)}>
              <Icon size={16} className="notif__icon" aria-hidden="true" />
              <span><strong>{r.title}</strong>{r.body && <small>{r.body}</small>}</span>
            </button>
          );
        })}
        {bell.items.map((n) => (
          <button type="button" key={n.id} className={`notif__item ${n.read ? '' : 'is-unread'}`} onClick={() => open(n)}>
            <span className="notif__dot" aria-label={n.read ? undefined : 'Unread'} />
            <span><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}<small className="notif__time">{ago(n.createdAt)}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

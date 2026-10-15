import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info, ListTodo } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card } from '../ui/Ui.jsx';

const ICON = { bad: AlertCircle, warn: AlertTriangle, info: Info };
const when = (iso) => {
  if (!iso) return '';
  const s = String(iso);
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
  if (days < -1) return `${-days} days ago`;
  if (days === -1) return 'yesterday';
  if (days === 0) return s.length > 10 ? `today ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return d.toLocaleDateString('en-IN', { weekday: 'long' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** One list of what to do next, most urgent first, each with its date and a link to do it. */
export default function TodoCard({ path, limit = 6 }) {
  const { data } = useFetch(path);
  if (!data) return null;
  const items = data.items.slice(0, limit);
  return (
    <Card title={`To do${data.items.length ? ` (${data.items.length})` : ''}`} icon={ListTodo}>
      {items.length === 0 ? (
        <p className="todo-empty"><CheckCircle2 size={16} /> Nothing waiting. You are all caught up.</p>
      ) : (
        <ul className="todo-list">
          {items.map((i) => {
            const Icon = ICON[i.tone] || Info;
            return (
              <li key={i.key}>
                <Link to={i.link} className={`todo-item todo-item--${i.tone}`}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="todo-item__text"><strong>{i.title}</strong>{i.detail && <small>{i.detail}</small>}</span>
                  {i.due && <span className="todo-item__when">{i.tone === 'bad' && i.kind !== 'quiz' ? 'Was due ' : 'Due '}{when(i.due)}</span>}
                  <ChevronRight size={15} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data.items.length > limit && <p className="note">{data.items.length - limit} more. The most urgent are shown first.</p>}
    </Card>
  );
}

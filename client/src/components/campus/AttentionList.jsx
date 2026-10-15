import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info } from 'lucide-react';

const ICON = { bad: AlertCircle, warn: AlertTriangle, info: Info };

/** "Needs your attention": the most urgent first (red, then amber, then blue), each a link to where it is done. */
export default function AttentionList({ items, empty = 'Nothing waiting. You are all caught up.' }) {
  const order = { bad: 0, warn: 1, info: 2 };
  const list = [...items].sort((a, b) => (order[a.tone] ?? 3) - (order[b.tone] ?? 3));
  if (!list.length) return <p className="todo-empty"><CheckCircle2 size={16} /> {empty}</p>;
  return (
    <ul className="todo-list">
      {list.map((i) => {
        const Icon = ICON[i.tone] || Info;
        return (
          <li key={i.key}>
            <Link to={i.link} className={`todo-item todo-item--${i.tone}`}>
              <Icon size={16} aria-label={i.tone === 'bad' ? 'Urgent' : i.tone === 'warn' ? 'To do' : 'For information'} />
              <span className="todo-item__text"><strong>{i.title}</strong>{i.detail && <small>{i.detail}</small>}</span>
              <ChevronRight size={15} aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

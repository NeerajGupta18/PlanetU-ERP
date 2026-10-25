import { Link } from 'react-router-dom';
import { ArrowRight, Send, Trash2 } from 'lucide-react';
import { PROCESSES } from '../../config/processes.js';
import { Badge } from '../ui/Ui.jsx';
import { fmtDate } from '../../utils/dates.js';

/** What fills each column when it is empty, and the one button on each card in it. */
const COLUMN = {
  enquiry: { empty: 'Add an enquiry when someone calls or visits, or share the application link.', action: 'Fill in at desk' },
  application: { empty: 'Submitted applications wait here until their documents are checked.', action: 'Check documents' },
  documents: { empty: 'Applications with every document verified wait here for a decision.', action: 'Decide' },
  decision: { empty: 'Waitlisted applications wait here.', action: 'Decide' },
  offer: { empty: 'Accepted applications wait here to be enrolled.', action: 'Enrol' },
  fee: { empty: 'Students enrolled without paying wait here until their fee is collected.', action: 'Collect fee' },
  enrolled: { empty: 'Students enrolled in the last 60 days show here.', action: 'View student' },
};

const when = (c) => {
  const d = c.stage === 'enquiry' ? c.createdAt : c.stage === 'application' || c.stage === 'documents' ? c.submittedAt : c.decidedAt || c.submittedAt;
  return d ? fmtDate(String(d).slice(0, 10)) : '';
};

/**
 * The admissions board: one column per step (names from config/processes.js), each card in the column of the step it
 * has reached, with the one thing to do next on its button. On a phone the columns scroll sideways, one at a time.
 */
export default function Board({ cards, counts, onOpen, onFill, onSendLink, onRemove, onEnrol }) {
  const steps = PROCESSES.admissions.steps;
  const act = (c) => {
    if (c.stage === 'enquiry') return onFill(c);
    if (c.stage === 'offer') return onEnrol(c);
    return onOpen(c.id);
  };
  return (
    <div className="board" role="list" aria-label="Admissions board">
      {steps.map((s, i) => {
        const list = cards.filter((c) => c.stage === s.key);
        return (
          <section key={s.key} className="board__col" role="listitem" aria-label={`${s.label}: ${counts[s.key] ?? 0}`}>
            <header className="board__head">
              <span className="board__num" aria-hidden="true">{i + 1}</span>
              <h3 className="board__title">{s.label}</h3>
              <span className="board__count">{counts[s.key] ?? 0}</span>
            </header>
            {list.length === 0 ? <p className="board__empty">{COLUMN[s.key].empty}</p> : (
              <ul className="board__cards">
                {list.map((c) => (
                  <li key={c.id} className="bcard">
                    <button type="button" className="bcard__open" onClick={() => (c.stage === 'enquiry' ? onFill(c) : onOpen(c.id))}>
                      <strong className="bcard__name">{c.name}</strong>
                      <span className="bcard__meta">{c.course} · {c.applicationNo}</span>
                    </button>
                    <div className="bcard__tags">
                      {c.source === 'walk_in' && <span className="tag">Desk</span>}
                      {c.stage === 'application' && (c.docRejected
                        ? <Badge tone="amber">Document sent back</Badge>
                        : <Badge tone="gray">{c.docsVerified} of {c.docsRequired} documents checked</Badge>)}
                      {c.stage === 'decision' && <Badge tone="purple">Waitlisted</Badge>}
                      {c.feeStatus === 'pending' && c.stage !== 'enquiry' && <Badge tone="amber">Application fee due</Badge>}
                      {c.stage === 'fee' && <Badge tone="amber">Fee not paid</Badge>}
                      <span className="muted bcard__when">{when(c)}</span>
                    </div>
                    <div className="bcard__actions">
                      {c.stage === 'fee' ? <Link className="btn btn--outline btn--sm" to={`/admin/fees?tab=students&student=${c.studentId}`}>{COLUMN.fee.action} <ArrowRight size={14} aria-hidden="true" /></Link>
                        : c.stage === 'enrolled' ? <Link className="btn btn--outline btn--sm" to={`/admin/students?open=${c.studentId}`}>{COLUMN.enrolled.action}</Link>
                          : <button type="button" className="btn btn--outline btn--sm" onClick={() => act(c)}>{COLUMN[c.stage].action} <ArrowRight size={14} aria-hidden="true" /></button>}
                      {c.stage === 'enquiry' && (
                        <>
                          <button type="button" className="icon-btn" onClick={() => onSendLink(c)} aria-label={`Send the form link to ${c.name}`} title="Send form link"><Send size={15} /></button>
                          <button type="button" className="icon-btn" onClick={() => onRemove(c)} aria-label={`Remove the enquiry from ${c.name}`} title="Remove enquiry"><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

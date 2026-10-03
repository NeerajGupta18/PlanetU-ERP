import { Link } from 'react-router-dom';
import { Building, ClipboardCheck, MapPin, Video } from 'lucide-react';
import { Badge } from '../ui/Ui.jsx';
import { EmptyState } from '../ui/Feedback.jsx';
import { fmtTime } from '../../utils/dates.js';

/** Where the marking of one lecture stands, as a badge. */
export function SessionBadge({ l }) {
  if (l.sessionStatus === 'submitted') return <Badge tone="green">Submitted · {l.attended}/{l.marked} attended</Badge>;
  if (l.sessionStatus === 'draft') return <Badge tone="amber">Draft · {l.marked} of {l.roster} marked</Badge>;
  return <Badge tone="gray">Not marked</Badge>;
}

/**
 * Timetable-style list of dated lectures with their marking status and a button to open the sheet.
 *   showFaculty  admin view: show who is teaching it
 *   markTo(l)    link target for the marking sheet
 */
export default function LectureList({ lectures, holiday, markTo, showFaculty = false }) {
  if (holiday) return <EmptyState title="Holiday" hint="No lectures run on this date, so there is nothing to mark." />;
  if (!lectures.length) return <EmptyState title="No lectures" hint="Nothing on the timetable for this date." />;
  return (
    <ul className="schedule">
      {lectures.map((l) => (
        <li key={l.slotId} className="schedule__item">
          <div className="schedule__time"><strong>{fmtTime(l.start)}</strong><small>{fmtTime(l.end)}</small></div>
          <div className="schedule__body" style={{ flex: 1 }}>
            <div className="schedule__title">
              {l.subject}
              <SessionBadge l={l} />
              {l.reassigned && <Badge tone="purple">Reassigned</Badge>}
            </div>
            <div className="schedule__meta">
              <span><Building size={12} /> {l.course} · {l.roster} students</span>
              <span>{l.mode === 'Online' ? <Video size={12} /> : <MapPin size={12} />} {l.location}</span>
              {showFaculty && <span>{l.facultyName}</span>}
            </div>
          </div>
          <Link className={`btn btn--sm ${l.sessionStatus === 'submitted' ? 'btn--outline' : 'btn--primary'}`} to={markTo(l)} style={{ alignSelf: 'center' }}>
            <ClipboardCheck size={14} /> {l.sessionStatus === 'submitted' ? 'Review' : l.sessionStatus === 'draft' ? 'Continue' : 'Mark'}
          </Link>
        </li>
      ))}
    </ul>
  );
}

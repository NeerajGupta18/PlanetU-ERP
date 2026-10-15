import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, ListChecks, X } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card } from '../ui/Ui.jsx';

const KEY = 'erp.setup.hidden';
const hiddenNow = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/** "Set up your institute": the few steps before the system is useful, until they are all done (or hidden). */
export default function SetupChecklist() {
  const [hidden, setHidden] = useState(hiddenNow);
  const [showDone, setShowDone] = useState(false);
  const { data } = useFetch(hidden ? null : '/admin/setup-status');
  if (hidden || !data || data.complete) return null;
  const hide = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } setHidden(true); };
  const next = data.steps.find((s) => !s.done);
  return (
    <Card
      title={`Set up your institute: ${data.done} of ${data.total} done`} icon={ListChecks}
      action={<button type="button" className="icon-btn" onClick={hide} aria-label="Hide the setup checklist" title="Hide"><X size={16} /></button>}
    >
      <div className="progress" role="progressbar" aria-label="Setup steps done" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}><div className="progress__fill" style={{ width: `${(data.done / data.total) * 100}%` }} /></div>
      <div className="checklist">
        {data.steps.filter((s) => showDone || !s.done).map((s) => (
          <Link key={s.key} to={s.to} className={`checklist__item ${s.done ? 'is-done' : ''}`}>
            <span className="checklist__mark" role="img" aria-label={s.done ? 'Done' : 'Not done'}><Check size={13} /></span>
            <span>{s.label}</span>
            {s === next && <b className="checklist__go">Do this next <ChevronRight size={13} style={{ verticalAlign: '-2px' }} /></b>}
          </Link>
        ))}
      </div>
      {data.done > 0 && (
        <button type="button" className="link-btn" style={{ marginTop: 10, fontSize: 13 }} onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
          {showDone ? 'Hide the finished steps' : `Show the ${data.done} finished step${data.done === 1 ? '' : 's'}`}
        </button>
      )}
    </Card>
  );
}

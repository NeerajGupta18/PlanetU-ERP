import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Rocket, X } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card } from '../ui/Ui.jsx';
import { PROCESSES } from '../../config/processes.js';

const KEY = 'erp.setup.hidden';
const hiddenNow = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const labelOf = (key) => PROCESSES.setup.steps.find((s) => s.key === key)?.label;

/**
 * "Set up your institute" on the admin dashboard: the seven wizard steps and the way back in, until all are done (or hidden).
 * Pass `wizard` (GET /admin/setup) when the page already has it.
 */
export default function SetupChecklist({ wizard }) {
  const [hidden, setHidden] = useState(hiddenNow);
  const fetched = useFetch(hidden || wizard ? null : '/admin/setup').data;
  const data = wizard || fetched;
  if (hidden || !data || data.complete) return null;
  const hide = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } setHidden(true); };
  return (
    <Card
      title={`Set up your institute: ${data.done} of ${data.total} done`} icon={Rocket}
      action={<button type="button" className="icon-btn" onClick={hide} aria-label="Hide the setup checklist" title="Hide"><X size={16} /></button>}
    >
      <div className="progress" role="progressbar" aria-label="Setup steps done" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}><div className="progress__fill" style={{ width: `${(data.done / data.total) * 100}%` }} /></div>
      <div className="checklist">
        {data.steps.map((s, i) => (
          <Link key={s.key} to={`/admin/setup?tab=${s.key}`} className={`checklist__item ${s.done ? 'is-done' : ''}`}>
            <span className="checklist__mark" role="img" aria-label={s.done ? 'Done' : 'Not done'}><Check size={13} /></span>
            <span>{i + 1}. {labelOf(s.key)}</span>
            {s.key === data.current && <b className="checklist__go">Do this next <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></b>}
          </Link>
        ))}
      </div>
      <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <Link className="btn btn--next" to={`/admin/setup?tab=${data.current}`}>Continue setup <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </Card>
  );
}

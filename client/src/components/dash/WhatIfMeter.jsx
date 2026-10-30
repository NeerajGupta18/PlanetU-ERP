import { useState } from 'react';
import { whatIfAttendance } from '../../utils/kpi.js';

const MAX_MISSED = 30;

/** "If Aarav misses N more classes, attendance becomes X%": worked out from the real counts and the institute's minimum. */
export default function WhatIfMeter({ attended, total, threshold, name, you = false }) {
  const [missed, setMissed] = useState(0);
  if (!total) return null;
  const value = whatIfAttendance(attended, total, missed);
  const low = value < threshold;
  const who = you ? 'you miss' : `${name} misses`;
  return (
    <div className="whatif">
      <label htmlFor="whatif-range" className="dash-h3">What if?</label>
      <input
        id="whatif-range" type="range" className="whatif__range" min="0" max={MAX_MISSED} step="1" value={missed}
        onChange={(e) => setMissed(Number(e.target.value))}
        aria-valuetext={`${missed} more ${missed === 1 ? 'class' : 'classes'} missed, attendance ${value}%`}
      />
      <p className="whatif__line" aria-live="polite">
        If {who} <strong>{missed}</strong> more {missed === 1 ? 'class' : 'classes'}, attendance becomes <strong className={low ? 'is-bad' : ''}>{value}%</strong>.
        {' '}<span className={low ? 'is-bad' : 'is-good'}>{low ? `Below the ${threshold}% minimum.` : `Still at or above the ${threshold}% minimum.`}</span>
      </p>
    </div>
  );
}

import { useState } from 'react';
import { Check } from 'lucide-react';
import { CYCLE_LABEL, annualSaving, inr, inr0, planPrice } from '../../utils/billing.js';

/**
 * Plan cards with a monthly/annual switch. `onPick(planKey, cycle)`. Prices are before GST, and the
 * estimate for the institute's own student count is shown so the cost is never a surprise.
 */
export default function PlanPicker({ plans, current, currentCycle = 'monthly', students = 0, gstRate = 18, immediate, busy, onPick }) {
  const [cycle, setCycle] = useState(currentCycle === 'annual' ? 'annual' : 'monthly');
  const months = cycle === 'annual' ? 12 : 1;

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Billing cycle" style={{ marginBottom: 14, background: 'var(--brand-50)' }}>
        {['monthly', 'annual'].map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cycle === c} className={`segmented__item ${cycle === c ? 'is-active' : ''}`} style={{ color: cycle === c ? undefined : 'var(--brand-700)' }} onClick={() => setCycle(c)}>
            {CYCLE_LABEL[c]}{c === 'annual' ? ' · 2 months free' : ''}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {plans.map((p) => {
          const extra = Math.max(0, students - p.includedStudents);
          const base = planPrice(p, cycle);
          const est = base + extra * p.extraStudentPrice * months;
          const isCurrent = p.key === current && cycle === currentCycle;
          return (
            <div key={p.key} style={{ border: `2px solid ${isCurrent ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: 17 }}>{p.name}</strong>
              <div style={{ margin: '6px 0 2px' }}>
                <span style={{ fontSize: 26, fontWeight: 800 }}>{inr0(base)}</span>
                <span className="muted"> / {cycle === 'annual' ? 'year' : 'month'}</span>
              </div>
              <small className="muted">+ {gstRate}% GST{cycle === 'annual' && annualSaving(p) > 0 ? ` · save ${inr0(annualSaving(p))}` : ''}</small>
              <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>{p.description}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', fontSize: 13, flex: 1 }}>
                {p.features.map((f) => <li key={f} style={{ display: 'flex', gap: 6, marginBottom: 4 }}><Check size={14} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} /> {f}</li>)}
              </ul>
              <small className="muted" style={{ marginBottom: 8 }}>
                For your {students} student{students === 1 ? '' : 's'}: about <strong>{inr(est)}</strong> before GST{extra > 0 ? ` (${extra} above the allowance)` : ''}.
              </small>
              <button type="button" className={`btn ${isCurrent ? 'btn--outline' : 'btn--primary'} btn--sm`} disabled={busy || isCurrent} onClick={() => onPick(p.key, cycle)}>
                {isCurrent ? 'Your current plan' : immediate ? `Choose ${p.name}` : `Switch to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="note">{immediate ? 'You will get an invoice straight away and can pay it online.' : 'A plan change starts from your next invoice. Nothing is charged today.'}</p>
    </>
  );
}

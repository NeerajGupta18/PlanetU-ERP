export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inr0 = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

export const SUB_STATUS = {
  trialing: { label: 'Free trial', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  past_due: { label: 'Payment overdue', tone: 'amber' },
  suspended: { label: 'Access paused', tone: 'red' },
};
export const INVOICE_STATUS = { open: { label: 'Unpaid', tone: 'amber' }, paid: { label: 'Paid', tone: 'green' }, void: { label: 'Void', tone: 'gray' } };
export const CYCLE_LABEL = { monthly: 'Monthly', annual: 'Annual' };
export const METHOD_LABEL = { bank_transfer: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', other: 'Other' };
export const SUSPEND_REASON = { unpaid: 'Unpaid invoice', trial_ended: 'Trial ended', cancelled: 'Cancelled' };

/** A plan's price for a cycle, and what the annual cycle saves against twelve monthly payments. */
export const planPrice = (p, cycle) => (cycle === 'annual' ? p.annualPrice : p.monthlyPrice);
export const annualSaving = (p) => Math.max(0, p.monthlyPrice * 12 - p.annualPrice);

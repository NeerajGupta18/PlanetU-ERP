import { todayISO } from './dates.js';

/**
 * How a single fee charge is shown. Red only when it is past its due date and not fully paid;
 * a charge that is simply not due yet is blue, part-paid is amber, paid is green.
 */
export function feeItemBadge(item) {
  const due = item.dueDate ? String(item.dueDate).slice(0, 10) : null;
  if (item.status === 'paid') return { tone: 'green', label: 'Paid' };
  if (item.status === 'waived') return { tone: 'gray', label: 'Waived' };
  if (due && due < todayISO()) return { tone: 'red', label: item.status === 'partial' ? 'Part paid, overdue' : 'Overdue' };
  if (item.status === 'partial') return { tone: 'amber', label: 'Part paid' };
  return { tone: 'blue', label: 'Not due yet' };
}

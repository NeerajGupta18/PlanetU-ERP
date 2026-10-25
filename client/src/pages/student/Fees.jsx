import { useState } from 'react';
import { Banknote, CreditCard, FileText, Receipt, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import PayOnlineModal from '../../components/fees/PayOnlineModal.jsx';
import { feeItemBadge } from '../../utils/fees.js';
import { fmtDate, todayISO } from '../../utils/dates.js';

const inr0 = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const isOpen = (i) => (i.status === 'unpaid' || i.status === 'partial') && Number(i.amount) - Number(i.paid) > 0;
// What is still to pay first (earliest due first), then everything already settled
const byWhatToPay = (a, b) => (isOpen(b) - isOpen(a)) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The outstanding card says when the next payment is due, and turns red once something is overdue. */
function dueStatus(items, outstanding) {
  if (!(outstanding > 0)) return { status: 'good', hint: 'Fully paid' };
  const open = items.filter((i) => ['unpaid', 'partial'].includes(i.status) && i.dueDate).map((i) => String(i.dueDate).slice(0, 10)).sort();
  if (!open.length) return { status: 'warn', hint: 'To pay' };
  return open[0] < todayISO() ? { status: 'bad', hint: `Overdue since ${fmtDate(open[0])}` } : { status: 'warn', hint: `Next due ${fmtDate(open[0])}` };
}

export default function Fees() {
  const { data, loading, error, reload } = useFetch('/student/fees');
  const history = useFetch('/student/fees/payments');
  const online = useFetch('/student/fees/online/config');
  const [paying, setPaying] = useState(null); // scope for PayOnlineModal
  const canPayOnline = Boolean(online.data?.enabled);

  const refresh = () => { setPaying(null); reload(); history.reload(); };

  return (
    <>
      <PageBanner
        icon={Wallet} title="My Fees" subtitle="Charges, payments and receipts"
        next={data && (data.summary.outstanding > 0
          ? (canPayOnline ? `Pay ${inr0(data.summary.outstanding)} online, all at once or one charge at a time` : `Pay ${inr0(data.summary.outstanding)} at the institute's fee counter`)
          : 'Nothing to pay. Receipts are below.')}
      />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <div className="stats stats--3">
              <StatCard value={inr0(data.summary.total)} label="Total charged" icon={Receipt} />
              <StatCard value={inr0(data.summary.paid)} label="Paid" icon={Banknote} />
              <StatCard value={inr0(data.summary.outstanding)} label="Outstanding" icon={Wallet} {...dueStatus(data.items, data.summary.outstanding)} />
            </div>
            <Card
              title="Charges"
              action={canPayOnline && data.summary.outstanding > 0 && (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setPaying({ label: 'All outstanding fees', due: data.summary.outstanding })}>
                  <CreditCard size={14} /> Pay online
                </button>
              )}
            >
              {!canPayOnline && data.summary.outstanding > 0 && (
                <p className="note" style={{ marginTop: 0 }}>Pay at the institute's fee counter (cash, UPI, card or cheque). The receipt then appears below.</p>
              )}
              {data.items.length === 0 ? <EmptyState compact title="No charges yet" hint="Fees show here once the institute adds them." /> : (
                <div className="table-wrap">
                  <table className="table table--stack">
                    <thead><tr><th>Item</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th>{canPayOnline && <th />}</tr></thead>
                    <tbody>
                      {[...data.items].sort(byWhatToPay).map((i) => {
                        const balance = Number(i.amount) - Number(i.paid);
                        const open = isOpen(i);
                        return (
                          <tr key={i.id}>
                            <td><strong>{i.label}</strong></td><td className="muted" data-label="Due">{i.dueDate ? fmtDate(i.dueDate) : '-'}</td>
                            <td data-label="Amount">{inr(i.amount)}</td><td data-label="Paid">{inr(i.paid)}</td>
                            <td><Badge tone={feeItemBadge(i).tone}>{feeItemBadge(i).label}</Badge></td>
                            {canPayOnline && (
                              <td>{open && <button type="button" className="btn btn--outline btn--sm" onClick={() => setPaying({ feeItemId: i.id, label: i.label, due: balance })}>Pay</button>}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Payments & receipts">
              <DataBoundary loading={history.loading} error={history.error} data={history.data} reload={history.reload}>
                {history.data && (history.data.payments.length === 0 ? <EmptyState compact title="No payments yet" hint="Each payment and its receipt show here." /> : (
                  <div className="table-wrap">
                    <table className="table table--stack">
                      <thead><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Method</th><th /></tr></thead>
                      <tbody>
                        {history.data.payments.map((p) => (
                          <tr key={p.id}>
                            <td><strong>{p.receiptNo}</strong></td>
                            <td className="muted" data-label="Date">{fmtDate(p.paidAt.slice(0, 10))}</td>
                            <td data-label="Amount">{inr(p.amount)}</td>
                            <td data-label="Method">{p.method.replace('_', ' ')}</td>
                            <td><a className="btn btn--outline btn--sm" href={`/api/student/fees/payments/${p.id}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={13} /> Receipt</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </DataBoundary>
            </Card>
          </>
        )}
      </DataBoundary>
      {paying && <PayOnlineModal scope={paying} onClose={() => setPaying(null)} onDone={refresh} />}
    </>
  );
}

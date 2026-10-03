import { useState } from 'react';
import { CreditCard, FileText, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import PayOnlineModal from '../../components/fees/PayOnlineModal.jsx';
import { fmtDate } from '../../utils/dates.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_TONE = { unpaid: 'red', partial: 'amber', paid: 'green', waived: 'gray' };

export default function Fees() {
  const { data, loading, error, reload } = useFetch('/student/fees');
  const history = useFetch('/student/fees/payments');
  const online = useFetch('/student/fees/online/config');
  const [paying, setPaying] = useState(null); // scope for PayOnlineModal
  const canPayOnline = Boolean(online.data?.enabled);

  const refresh = () => { setPaying(null); reload(); history.reload(); };

  return (
    <>
      <PageBanner icon={Wallet} title="My Fees" subtitle="Charges, payments and receipts" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <div className="stats">
              <div className="stat"><span className="stat__value">{inr(data.summary.total)}</span><span className="stat__label">Total charged</span></div>
              <div className="stat"><span className="stat__value">{inr(data.summary.paid)}</span><span className="stat__label">Paid</span></div>
              <div className="stat"><span className="stat__value">{inr(data.summary.outstanding)}</span><span className="stat__label">Outstanding</span></div>
            </div>
            <Card
              title="Charges"
              action={canPayOnline && data.summary.outstanding > 0 && (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setPaying({ label: 'All outstanding fees', due: data.summary.outstanding })}>
                  <CreditCard size={14} /> Pay online
                </button>
              )}
            >
              {data.items.length === 0 ? <EmptyState title="No charges yet" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Item</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th>{canPayOnline && <th />}</tr></thead>
                    <tbody>
                      {data.items.map((i) => {
                        const balance = Number(i.amount) - Number(i.paid);
                        const open = (i.status === 'unpaid' || i.status === 'partial') && balance > 0;
                        return (
                          <tr key={i.id}>
                            <td>{i.label}</td><td className="muted">{i.dueDate ? fmtDate(i.dueDate) : '-'}</td>
                            <td>{inr(i.amount)}</td><td>{inr(i.paid)}</td>
                            <td><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge></td>
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
                {history.data && (history.data.payments.length === 0 ? <EmptyState title="No payments yet" /> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Method</th><th /></tr></thead>
                      <tbody>
                        {history.data.payments.map((p) => (
                          <tr key={p.id}>
                            <td>{p.receiptNo}</td>
                            <td className="muted">{fmtDate(p.paidAt.slice(0, 10))}</td>
                            <td>{inr(p.amount)}</td>
                            <td>{p.method.replace('_', ' ')}</td>
                            <td><a className="btn btn--outline btn--sm" href={`/api/student/fees/payments/${p.id}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={13} /></a></td>
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

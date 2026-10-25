import { FileText, Banknote } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { inr } from '../../utils/billing.js';
import { monthWord } from '../admin/Payroll.jsx';

export default function Payslips() {
  const { data, loading, error, reload } = useFetch('/employee/payslips');
  return (
    <>
      <PageBanner icon={Banknote} title="My payslips" subtitle="Your monthly payslips, once the office has finalised them" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.payslips.length === 0 ? <EmptyState title="No payslips yet" hint="Your payslip appears here after the office finalises the month." /> : (
          <Card>
            <div className="table-wrap">
              <table className="table table--stack">
                <thead><tr><th>Month</th><th>Gross</th><th>Deductions</th><th>Net pay</th><th /></tr></thead>
                <tbody>
                  {data.payslips.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{monthWord(p.month)}</strong>{p.unpaidDays > 0 && <div className="muted">{p.unpaidDays} day{p.unpaidDays === 1 ? '' : 's'} unpaid leave</div>}</td>
                      <td>{inr(p.gross)}</td><td>{inr(p.totalDeductions)}</td><td><strong>{inr(p.net)}</strong></td>
                      <td className="row-actions"><a className="btn btn--outline btn--sm" href={`/api/employee/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer"><FileText size={13} /> Payslip</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </DataBoundary>
    </>
  );
}

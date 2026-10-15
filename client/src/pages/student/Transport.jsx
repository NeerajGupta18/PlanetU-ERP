import { Bus } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, Field, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { inr0 } from '../../utils/billing.js';
import { fmtDate, fmtTime } from '../../utils/dates.js';

export default function Transport() {
  const { data, loading, error, reload } = useFetch('/student/transport');
  const c = data?.current;
  return (
    <>
      <PageBanner icon={Bus} title="Transport" subtitle="Your bus route and stop" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (!c ? (
          <EmptyState title="Not on a bus route" hint="Please ask the transport office if you would like to use the college bus." />
        ) : (
          <Card title={c.route}>
            <dl className="fields fields--3">
              <Field label="Your stop">{c.stop}</Field>
              <Field label="Pickup time">{c.pickupTime ? fmtTime(c.pickupTime) : '-'}</Field>
              <Field label="Riding since">{fmtDate(c.from)}</Field>
              <Field label="Vehicle">{c.vehicleNo || '-'}</Field>
              <Field label="Driver">{c.driverName || '-'}{c.driverPhone && <div className="muted">{c.driverPhone}</div>}</Field>
              <Field label="Charge">{inr0(c.monthlyFee)} a month</Field>
            </dl>
          </Card>
        ))}
        {data?.history.length > 0 && (
          <Card title="Earlier rides">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Route</th><th>Stop</th><th>From</th><th>Until</th></tr></thead>
              <tbody>{data.history.map((h) => <tr key={h.id}><td>{h.route}</td><td>{h.stop}</td><td>{fmtDate(h.from)}</td><td>{fmtDate(h.to)}</td></tr>)}</tbody>
            </table></div>
          </Card>
        )}
      </DataBoundary>
    </>
  );
}

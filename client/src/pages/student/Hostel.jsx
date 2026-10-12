import { BedDouble } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, Field, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { inr0 } from '../../utils/billing.js';
import { fmtDate } from '../../utils/dates.js';

export default function Hostel() {
  const { data, loading, error, reload } = useFetch('/student/hostel');
  return (
    <>
      <PageBanner icon={BedDouble} title="Hostel" subtitle="Your room and hostel details" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (!data.current ? (
          <EmptyState title="No hostel room" hint="A room has not been allotted. Please ask the hostel office if you need one." />
        ) : (
          <Card title="Current room">
            <div className="fields fields--3">
              <Field label="Hostel">{data.current.hostel} <Badge tone="blue">{data.hostel.kind === 'boys' ? 'Boys' : data.hostel.kind === 'girls' ? 'Girls' : 'Mixed'}</Badge></Field>
              <Field label="Room">{data.current.roomNo} (floor {data.current.floor})</Field>
              <Field label="Staying since">{fmtDate(data.current.from)}</Field>
              <Field label="Charge">{inr0(data.current.monthlyFee)} a month</Field>
              <Field label="Warden">{data.hostel.warden || '-'}{data.hostel.wardenEmail && <div className="muted">{data.hostel.wardenEmail}</div>}</Field>
              <Field label="Hostel phone">{data.hostel.phone || '-'}</Field>
            </div>
          </Card>
        ))}
        {data?.history.length > 0 && (
          <Card title="Earlier stays">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Hostel</th><th>Room</th><th>From</th><th>Until</th></tr></thead>
              <tbody>{data.history.map((h) => <tr key={h.id}><td>{h.hostel}</td><td>{h.roomNo}</td><td>{fmtDate(h.from)}</td><td>{fmtDate(h.to)}</td></tr>)}</tbody>
            </table></div>
          </Card>
        )}
      </DataBoundary>
    </>
  );
}

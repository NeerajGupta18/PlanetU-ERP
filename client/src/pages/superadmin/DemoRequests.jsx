import { useState } from 'react';
import { Inbox, Mail, Phone } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageHeader } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import DataTable from '../../components/ui/DataTable.jsx';

const TONE = { new: 'amber', contacted: 'blue', closed: 'gray' };
const LABEL = { new: 'New', contacted: 'Contacted', closed: 'Closed' };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "Book a demo" requests from the public landing page: call each new one, then mark it. */
export default function DemoRequests() {
  const { toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/super-admin/demo-requests');
  const [busy, setBusy] = useState(null);

  const mark = async (r, status) => {
    setBusy(r.id);
    try {
      await api.put(`/super-admin/demo-requests/${r.id}`, { status });
      toast.success(`${r.institute} marked ${LABEL[status].toLowerCase()}.`);
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };

  const n = data?.newCount || 0;
  return (
    <>
      <PageHeader icon={Inbox} title="Demo requests" subtitle={'Sent from the "Book a demo" form on the public page.'}
        next={n ? `call ${n} new request${n === 1 ? '' : 's'}, then mark ${n === 1 ? 'it' : 'them'} contacted` : null} />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        <Card>
          <DataTable caption="Demo requests" rows={data?.requests}
            empty={{ title: 'No demo requests yet', hint: 'Requests appear here when someone fills in "Book a demo" on the public page. Share the site address to get the first one.', action: { label: 'Open the public page', to: '/' } }}
            columns={[
              { key: 'institute', label: 'Institute', render: (r) => <><strong>{r.institute}</strong><br /><small className="muted">{r.instituteType}{r.city ? ` · ${r.city}` : ''}{r.students ? ` · ${r.students} students` : ''}</small></> },
              { key: 'name', label: 'Contact', render: (r) => <>{r.name}<br /><small><a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}><Phone size={12} aria-hidden="true" /> {r.phone}</a> · <a href={`mailto:${r.email}`}><Mail size={12} aria-hidden="true" /> {r.email}</a></small>{r.message && <><br /><small className="muted">{r.message}</small></>}</> },
              { key: 'createdAt', label: 'Received', muted: true, render: (r) => when(r.createdAt) },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge> },
              { key: 'actions', label: '', actions: true, render: (r) => (r.status === 'new'
                ? <button type="button" className="btn btn--outline" disabled={busy === r.id} onClick={() => mark(r, 'contacted')}>Mark contacted</button>
                : r.status === 'contacted'
                  ? <button type="button" className="btn btn--outline" disabled={busy === r.id} onClick={() => mark(r, 'closed')}>Close</button>
                  : <button type="button" className="btn btn--outline" disabled={busy === r.id} onClick={() => mark(r, 'new')}>Reopen</button>) },
            ]} />
        </Card>
      </DataBoundary>
    </>
  );
}

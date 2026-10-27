import { useState } from 'react';
import { Inbox, Mail, MessageCircle, Phone } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageHeader } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import DataTable from '../../components/ui/DataTable.jsx';

const TONE = { new: 'amber', contacted: 'blue', closed: 'gray' };
const LABEL = { new: 'New', contacted: 'Contacted', closed: 'Closed' };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** The next status button for a request or a message: new -> contacted -> closed -> new. */
const NEXT = { new: ['contacted', 'Mark contacted'], contacted: ['closed', 'Close'], closed: ['new', 'Reopen'] };

/** "Book a demo" requests from the public landing page (the form and the help chat), and messages left in the chat. */
export default function DemoRequests() {
  const { toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/super-admin/demo-requests');
  const messages = useFetch('/super-admin/support-messages');
  const [busy, setBusy] = useState(null);

  const mark = async (r, status, path = 'demo-requests', name = r.institute) => {
    setBusy(r.id);
    try {
      await api.put(`/super-admin/${path}/${r.id}`, { status });
      toast.success(`${name} marked ${LABEL[status].toLowerCase()}.`);
      if (path === 'demo-requests') reload(); else messages.reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };

  const n = (data?.newCount || 0) + (messages.data?.newCount || 0);
  return (
    <>
      <PageHeader icon={Inbox} title="Demo requests" subtitle={'Sent from the "Book a demo" form and the help chat on the public page.'}
        next={n ? `reply to ${n} new request${n === 1 ? '' : 's'} or message${n === 1 ? '' : 's'}, then mark ${n === 1 ? 'it' : 'them'} contacted` : null} />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        <Card>
          <DataTable caption="Demo requests" rows={data?.requests}
            empty={{ title: 'No demo requests yet', hint: 'Requests appear here when someone fills in "Book a demo" on the public page. Share the site address to get the first one.', action: { label: 'Open the public page', to: '/' } }}
            columns={[
              { key: 'institute', label: 'Institute', render: (r) => <><strong>{r.institute}</strong>{r.source === 'chat' && <> <Badge tone="blue">From the chat</Badge></>}<br /><small className="muted">{r.instituteType}{r.city ? ` · ${r.city}` : ''}{r.students ? ` · ${r.students} students` : ''}</small></> },
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
      <DataBoundary loading={messages.loading} error={messages.error} data={messages.data} reload={messages.reload}>
        <Card title="Messages from the help chat" icon={MessageCircle}>
          <DataTable caption="Messages from the help chat" rows={messages.data?.messages}
            empty={{ title: 'No messages yet', hint: 'Visitors who ask for a person, or ask about prices or contracts, can leave a message in the chat on the public page.' }}
            columns={[
              { key: 'name', label: 'From', render: (r) => <><strong>{r.name}</strong><br /><small>{r.contact.includes('@') ? <a href={`mailto:${r.contact}`}><Mail size={12} aria-hidden="true" /> {r.contact}</a> : <a href={`tel:${r.contact.replace(/[^\d+]/g, '')}`}><Phone size={12} aria-hidden="true" /> {r.contact}</a>}</small></> },
              { key: 'message', label: 'Message', render: (r) => r.message },
              { key: 'createdAt', label: 'Received', muted: true, render: (r) => when(r.createdAt) },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge> },
              { key: 'actions', label: '', actions: true, render: (r) => <button type="button" className="btn btn--outline" disabled={busy === r.id} onClick={() => mark(r, NEXT[r.status][0], 'support-messages', r.name)}>{NEXT[r.status][1]}</button> },
            ]} />
        </Card>
      </DataBoundary>
    </>
  );
}

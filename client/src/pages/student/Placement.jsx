import { useState } from 'react';
import { Briefcase, MapPin } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';
import { uploadFile } from '../../utils/upload.js';

const MY = { applied: { label: 'Applied', tone: 'blue' }, shortlisted: { label: 'Shortlisted', tone: 'amber' }, selected: { label: 'Selected', tone: 'green' }, rejected: { label: 'Not selected', tone: 'red' }, withdrawn: { label: 'Withdrawn', tone: 'gray' } };

export default function Placement() {
  const { confirm, toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/student/placement');
  const [busy, setBusy] = useState('');
  const [files, setFiles] = useState({});
  const apply = async (d) => {
    setBusy(d.id);
    try {
      const resumeFileId = files[d.id] ? await uploadFile(files[d.id], 'document') : undefined;
      await api.post(`/student/placement/${d.id}/apply`, { resumeFileId });
      toast.success('Application sent.'); reload();
    } catch (err) { toast.error(err); } finally { setBusy(''); }
  };
  const withdraw = async (d) => {
    if (!await confirm(`Withdraw your application to ${d.company}?`, { title: 'Withdraw application', confirmLabel: 'Withdraw', danger: true })) return;
    try { await api.post(`/student/placement/${d.id}/withdraw`); reload(); } catch (err) { toast.error(err); }
  };
  return (
    <>
      <PageBanner icon={Briefcase} title="Placement" subtitle="Companies visiting your campus. Apply to the drives you are eligible for." />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.drives.length === 0 ? <Card><EmptyState title="No drives right now" hint="When the placement office opens a drive it shows up here." /></Card> : (
          <div className="grid-2" style={{ alignItems: 'stretch' }}>
            {data.drives.map((d) => (
              <Card key={d.id} title={`${d.company}: ${d.title}`} action={d.myStatus ? <Badge tone={MY[d.myStatus].tone}>{MY[d.myStatus].label}</Badge> : d.eligible ? <Badge tone="green">Open</Badge> : <Badge tone="gray">Not available</Badge>}>
                <div className="badges" style={{ marginBottom: 8 }}>
                  {d.ctcLpa != null && <Badge tone="purple">{d.ctcLpa} LPA</Badge>}
                  {d.location && <Badge tone="gray"><MapPin size={11} /> {d.location}</Badge>}
                  {d.driveDate && <Badge tone="gray">Drive {fmtDate(d.driveDate)}</Badge>}
                  {d.applyBy && <Badge tone="gray">Apply by {fmtDate(d.applyBy)}</Badge>}
                </div>
                {d.description && <p className="muted" style={{ fontSize: 13.5 }}>{d.description}</p>}
                {d.myStatus === 'selected' && <p><strong>Offer: {d.myOffer ? `${d.myOffer} LPA` : 'details from the placement office'}</strong></p>}
                {d.myNote && <p className="muted">Note from the office: {d.myNote}</p>}
                {!d.myStatus || d.myStatus === 'withdrawn' ? (
                  d.eligible ? (
                    <div>
                      <label className="label" htmlFor={`rs-${d.id}`}>Resume (optional, PDF)</label>
                      <input id={`rs-${d.id}`} type="file" accept="application/pdf" onChange={(e) => setFiles({ ...files, [d.id]: e.target.files[0] })} />
                      <div className="form-actions" style={{ justifyContent: 'flex-start' }}><button type="button" className="btn btn--primary btn--sm" disabled={busy === d.id} onClick={() => apply(d)}>Apply</button></div>
                    </div>
                  ) : <p className="form-error" style={{ margin: 0 }}>{d.reasons.join('. ')}</p>
                ) : ['applied', 'shortlisted'].includes(d.myStatus) && (
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => withdraw(d)}>Withdraw</button>
                )}
              </Card>
            ))}
          </div>
        ))}
      </DataBoundary>
    </>
  );
}

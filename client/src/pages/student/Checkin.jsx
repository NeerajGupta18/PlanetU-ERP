import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, QrCode } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { fmtRange } from '../../utils/dates.js';

/**
 * Student check-in. The teacher's QR code opens this page with ?slot=...&code=...; the code is sent straight away.
 * A student can also open the page, pick the lecture and type the 6-digit code shown in class.
 */
export default function Checkin() {
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useFetch('/student/checkin/today');
  const [code, setCode] = useState('');
  const [slotId, setSlotId] = useState(params.get('slot') || '');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const auto = useRef(false);

  async function send(slot, c) {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post('/student/checkin', { slotId: slot, code: c });
      setMsg({ ok: true, text: r.already ? 'You were already marked for this lecture.' : r.status === 'late' ? 'You are checked in, marked late.' : 'You are checked in. Marked present.' });
      setCode(''); reload();
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }

  // Arrived from the QR code: submit once, then tidy the address bar so a refresh does not resend an old code
  useEffect(() => {
    const slot = params.get('slot'); const c = params.get('code');
    if (!auto.current && slot && c && data) {
      auto.current = true; setParams({}, { replace: true }); send(slot, c);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (data?.lectures || []).filter((l) => l.checkinOpen);
  useEffect(() => { if (!slotId && open.length === 1) setSlotId(open[0].slotId); }, [open.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageBanner icon={QrCode} title="Check in" subtitle="Scan the QR code your teacher shows in class, or type the 6-digit code." />
      {msg && <p className={msg.ok ? 'note' : 'form-error'} role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 15 }}>{msg.ok && <CheckCircle2 size={16} style={{ verticalAlign: '-3px' }} />} {msg.text}</p>}
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <Card title="Enter the code">
              <form onSubmit={(e) => { e.preventDefault(); if (slotId && code.length === 6) send(slotId, code); }}>
                <div className="fields">
                  <div className="form-field form-field--full"><label className="label" htmlFor="ci-slot">Lecture</label>
                    <select id="ci-slot" className="input" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                      <option value="">Choose...</option>{open.map((l) => <option key={l.slotId} value={l.slotId}>{l.subject} ({fmtRange(l.start, l.end)})</option>)}
                    </select>
                    {open.length === 0 && <small className="muted">No lecture has check-in open right now.</small>}</div>
                  <div className="form-field form-field--full"><label className="label" htmlFor="ci-code">6-digit code</label>
                    <input id="ci-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} /></div>
                </div>
                <div className="form-actions"><button className="btn btn--primary" disabled={busy || !slotId || code.length !== 6}>Check in</button></div>
              </form>
            </Card>
            <Card title="Today's lectures">
              {data.lectures.length === 0 ? <EmptyState title="No lectures today" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Time</th><th>Subject</th><th>Faculty</th><th>Check-in</th></tr></thead>
                  <tbody>{data.lectures.map((l) => (
                    <tr key={l.slotId}>
                      <td>{fmtRange(l.start, l.end)}</td><td><strong>{l.subject}</strong></td><td>{l.facultyName}</td>
                      <td>{l.myStatus && l.markedVia === 'qr' ? <Badge tone="green">You checked in ({l.myStatus})</Badge> : l.checkinOpen ? <Badge tone="blue">Open</Badge> : <Badge tone="gray">Not open</Badge>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              <p className="muted" style={{ marginTop: 10 }}>The code proves you have it in front of you, so please do not share it with classmates who are not in the room.</p>
            </Card>
          </>
        )}
      </DataBoundary>
    </>
  );
}

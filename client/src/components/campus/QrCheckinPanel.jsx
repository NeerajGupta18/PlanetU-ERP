import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../../api/http.js';
import { Badge, Card } from '../ui/Ui.jsx';
import { useDialogs } from '../ui/Dialogs.jsx';

/**
 * Faculty "QR check-in" for one lecture. The screen shows a QR code and a 6-digit code that change every 30 seconds;
 * students scan it (or type the code) on their own phone. Only a student of this class who is signed in can be marked.
 */
export default function QrCheckinPanel({ slotId, onCheckedIn }) {
  const { toast } = useDialogs();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const [qr, setQr] = useState('');
  const [left, setLeft] = useState(0);
  const last = useRef(0);
  const base = `/employee/attendance/checkin`;

  const refresh = useCallback(async () => {
    try { const s = await api.get(`${base}?slotId=${slotId}`); setSt(s); setLeft(s.secondsLeft || 0); last.current = s.checkedIn; return s; } catch (err) { toast.error(err); return null; }
  }, [slotId, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Fetch the new code a moment after the current one runs out, and the count every few seconds
  useEffect(() => {
    if (!st?.open) return undefined;
    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    const poll = setInterval(() => refresh(), 5000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [st?.open, refresh]);
  useEffect(() => { if (st?.open && left === 0) refresh(); }, [left, st?.open, refresh]);
  useEffect(() => { if (st && st.checkedIn !== undefined && onCheckedIn) onCheckedIn(st.checkedIn); }, [st?.checkedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!st?.open || !st.code) { setQr(''); return; }
    const url = `${window.location.origin}/student/checkin?slot=${slotId}&code=${st.code}`;
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [st?.code, st?.open, slotId]);

  async function start() {
    setBusy(true);
    try { const s = await api.post(base, { slotId, minutes }); setSt(s); setLeft(s.secondsLeft || 0); } catch (err) { toast.error(err); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { await api.post(`${base}/close`, { slotId }); await refresh(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  }

  return (
    <Card title="QR check-in" icon={QrCode} action={st?.open ? <Badge tone="green">Open</Badge> : <Badge tone="gray">Closed</Badge>}>
      {!st ? <p className="muted">Loading...</p> : st.open ? (
        <div className="qr-panel">
          <div className="qr-panel__code">
            {qr ? <img src={qr} alt="QR code for check-in" width={240} height={240} /> : <div style={{ width: 240, height: 240 }} />}
            <div className="qr-panel__digits" aria-label="Check-in code">{st.code ? `${st.code.slice(0, 3)} ${st.code.slice(3)}` : ''}</div>
            <small className="muted">New code in {left}s</small>
          </div>
          <div className="qr-panel__side">
            <p><strong>{st.checkedIn}</strong> of {st.roster} students checked in</p>
            <p className="muted">Show this screen to the class. Students open the app, choose Check in and scan the code, or type it. Anyone who checks in after {st.lateAfterMinutes} minutes is marked late.</p>
            {st.recent.length > 0 && <ul className="plain-list">{st.recent.map((r, i) => <li key={i}>{r.name} <Badge tone={r.status === 'late' ? 'amber' : 'green'}>{r.status}</Badge></li>)}</ul>}
            <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn--outline btn--sm" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
              <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={stop}><X size={14} /> Close check-in</button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="muted">Let students mark themselves present from their phones. You can still change anyone on the sheet below before you submit.{st.checkedIn > 0 ? ` ${st.checkedIn} already checked in today.` : ''}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="label" htmlFor="qr-min" style={{ margin: 0 }}>Keep open for</label>
            <select id="qr-min" className="input" style={{ maxWidth: 140 }} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={start}><QrCode size={15} /> Start check-in</button>
          </div>
        </div>
      )}
    </Card>
  );
}

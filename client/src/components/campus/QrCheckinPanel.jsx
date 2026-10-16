import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, QrCode, RefreshCw, TriangleAlert, X } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../../api/http.js';
import { getPosition } from '../../lib/device.js';
import { Badge, Card } from '../ui/Ui.jsx';
import { useDialogs } from '../ui/Dialogs.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';

/**
 * Faculty "QR check-in" for one lecture (colleges and universities). The teacher chooses how long check-in stays
 * open. While it is open the screen shows a QR code that quietly replaces itself every 10 seconds; students scan it
 * with the scanner inside the app. There is nothing to type. A photo of the screen is useless a few seconds later.
 */
export default function QrCheckinPanel({ slotId, onCheckedIn }) {
  const { toast } = useDialogs();
  const { hasModule } = useTenantConfig();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [useLocation, setUseLocation] = useState(false);
  const [big, setBig] = useState(false);
  const [qr, setQr] = useState('');
  const timer = useRef(0);
  const base = `/employee/attendance/checkin`;

  const refresh = useCallback(async () => {
    try { const s = await api.get(`${base}?slotId=${slotId}`); setSt(s); return s; } catch (err) { toast.error(err); return null; }
  }, [slotId, toast]);

  useEffect(() => { if (hasModule('qr_checkin')) refresh(); }, [refresh, hasModule]);

  // Fetch the next QR just as the current one runs out (this also refreshes the count of students)
  useEffect(() => {
    clearTimeout(timer.current);
    if (!st?.open) return undefined;
    timer.current = setTimeout(refresh, Math.max(1, st.secondsLeft || 1) * 1000 + 150);
    return () => clearTimeout(timer.current);
  }, [st, refresh]);
  useEffect(() => { if (st && st.checkedIn !== undefined && onCheckedIn) onCheckedIn(st.checkedIn); }, [st?.checkedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!st?.open || !st.token) { setQr(''); return; }
    QRCode.toDataURL(st.token, { margin: 2, width: 420, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [st?.token, st?.open]);

  async function start() {
    setBusy(true);
    try {
      let geo = {};
      if (useLocation) {
        const p = await getPosition(10000);
        if (!p) { toast.error('Allow location on this device to use the classroom location check, or untick it.'); return; }
        geo = { requireLocation: true, lat: p.lat, lng: p.lng };
      }
      setSt(await api.post(base, { slotId, minutes, ...geo }));
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { await api.post(`${base}/close`, { slotId }); await refresh(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  }

  if (!hasModule('qr_checkin')) return null;
  return (
    <Card title="QR check-in" icon={QrCode} action={st?.open ? <Badge tone="green">Open</Badge> : <Badge tone="gray">Closed</Badge>}>
      {!st ? <p className="muted">Loading...</p> : st.open ? (
        <div className="qr-panel">
          <div className={`qr-panel__code ${big ? 'qr-panel__code--big' : ''}`}>
            {qr ? <img src={qr} alt="Live QR code for check-in" width={260} height={260} /> : <div style={{ width: 260, height: 260 }} />}
            <small className="muted">Changes by itself every {st.windowSeconds} seconds. Nothing to type.</small>
          </div>
          <div className="qr-panel__side">
            <p><strong>{st.checkedIn}</strong> of {st.roster} students checked in</p>
            <p className="muted">Show this on the projector. Students open the PlanetU app, tap Scan and point the camera at it. Check-in closes in {Math.max(1, Math.round((new Date(st.closesAt) - Date.now()) / 60000))} min. Anyone who scans after {st.lateAfterMinutes} minutes is marked late.{st.locationRequired ? ` Students must be within ${st.radiusMetres} m of this room.` : ''}</p>
            {st.flagged?.length > 0 && (
              <div className="note" role="status">
                <strong><TriangleAlert size={14} style={{ verticalAlign: '-2px' }} /> Please check these students</strong>
                <ul className="plain-list">{st.flagged.map((f, i) => <li key={i}>{f.name}: {f.flag}</li>)}</ul>
              </div>
            )}
            {st.recent.length > 0 && <ul className="plain-list">{st.recent.map((r, i) => <li key={i}>{r.name} <Badge tone={r.status === 'late' ? 'amber' : 'green'}>{r.status}</Badge></li>)}</ul>}
            <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setBig((b) => !b)}><Maximize2 size={14} /> {big ? 'Smaller' : 'Show larger'}</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
              <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={stop}><X size={14} /> Close check-in</button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="muted">Let students mark themselves present by scanning a QR code in the app. The code changes every 10 seconds, so a photo sent to a friend does not work. You can still change anyone on the sheet below before you submit.{st.checkedIn > 0 ? ` ${st.checkedIn} already checked in today.` : ''}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="label" htmlFor="qr-min" style={{ margin: 0 }}>Keep check-in open for</label>
            <select id="qr-min" className="input" style={{ maxWidth: 140 }} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={start}><QrCode size={15} /> Start check-in</button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input type="checkbox" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
            <span>Only students inside this classroom (uses this device's location, about 150 m)</span>
          </label>
        </div>
      )}
    </Card>
  );
}

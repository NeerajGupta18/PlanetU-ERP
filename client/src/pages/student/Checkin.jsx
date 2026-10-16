import { useRef, useState } from 'react';
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import QrScanner from '../../components/campus/QrScanner.jsx';
import { deviceId, getPosition } from '../../lib/device.js';
import { fmtRange } from '../../utils/dates.js';

/**
 * Scan to mark attendance. The teacher shows a QR code in class; the student opens this page, taps Scan and points
 * the camera at it. The QR is replaced every few seconds and only this scanner can use it, so there is nothing to type.
 */
export default function Checkin() {
  const { data, loading, error, reload } = useFetch('/student/checkin/today');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const pos = useRef(null);
  const needsLocation = (data?.lectures || []).some((l) => l.needsLocation);

  async function open() {
    setResult(null); setScanning(true);
    if (needsLocation) pos.current = await getPosition(10000); // ask now, so the scan itself is quick
  }

  async function onCode(text) {
    setBusy(true);
    try {
      let p = pos.current;
      if (needsLocation && (!p || Date.now() - p.at > 45000)) p = pos.current = await getPosition(6000);
      const r = await api.post('/student/checkin', { token: text, deviceId: deviceId(), ...(needsLocation && p ? { lat: p.lat, lng: p.lng } : {}) });
      setResult({ ok: true, ...r });
      setScanning(false); reload();
    } catch (err) {
      setResult({ ok: false, message: err.message });
      setScanning(false);
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageBanner icon={ScanLine} title="Scan to mark attendance" subtitle="Point the camera at the QR code your teacher shows in class." />

      {result && (
        <div className={`scan-result ${result.ok ? 'is-ok' : 'is-bad'}`} role={result.ok ? 'status' : 'alert'}>
          {result.ok ? <CheckCircle2 size={44} /> : <XCircle size={44} />}
          <strong>{result.ok ? (result.already ? 'Already marked' : 'Attendance marked successfully') : 'Attendance not marked'}</strong>
          <span>{result.ok
            ? `${result.subject || 'This lecture'}: ${result.status === 'late' ? 'you are marked late.' : 'you are marked present.'}`
            : result.message}</span>
          <button type="button" className="btn btn--outline" onClick={open}>{result.ok ? 'Scan another' : 'Try again'}</button>
        </div>
      )}

      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            {scanning ? (
              <Card title="Scanning...">
                <QrScanner onResult={onCode} paused={busy} />
                <p className="muted" style={{ textAlign: 'center' }}>{busy ? 'Checking...' : 'Hold the phone steady so the whole QR code is inside the square.'}</p>
                <div className="form-actions" style={{ justifyContent: 'center' }}><button type="button" className="btn btn--outline" onClick={() => setScanning(false)}>Cancel</button></div>
              </Card>
            ) : !result && (
              <Card>
                <div className="scan-start">
                  <ScanLine size={48} />
                  <p>Open the camera and scan the QR code on the projector. You must be in the class: the code changes every few seconds, so a photo of it will not work.</p>
                  {needsLocation && <small className="muted">Your teacher has asked for your location, so please allow it when your phone asks.</small>}
                  <button type="button" className="btn btn--primary btn--lg" onClick={open}><ScanLine size={18} /> Scan QR code</button>
                </div>
              </Card>
            )}
            <Card title="Today's lectures">
              {data.lectures.length === 0 ? <EmptyState title="No lectures today" /> : (
                <ul className="lecture-rows">{data.lectures.map((l) => (
                  <li key={l.slotId}>
                    <div><strong>{l.subject}</strong><small className="muted">{fmtRange(l.start, l.end)} · {l.facultyName}</small></div>
                    {l.myStatus && l.markedVia === 'qr' ? <Badge tone="green">Marked ({l.myStatus})</Badge> : l.checkinOpen ? <Badge tone="blue">Open: scan now</Badge> : <Badge tone="gray">Not open</Badge>}
                  </li>
                ))}</ul>
              )}
            </Card>
          </>
        )}
      </DataBoundary>
    </>
  );
}

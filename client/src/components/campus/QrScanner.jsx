import { useEffect, useRef, useState } from 'react';

/**
 * The camera view that reads a QR code inside the app. It uses the phone's own QR reader when there is one
 * (BarcodeDetector) and a small JavaScript reader (jsQR) otherwise. It calls onResult once per code and then waits
 * until `paused` goes false again. Nothing is uploaded: only the text of the QR code is read.
 */
export default function QrScanner({ onResult, paused }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const sent = useRef(false);
  const cb = useRef(onResult);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  cb.current = onResult;
  useEffect(() => { if (!paused) sent.current = false; }, [paused]);

  useEffect(() => {
    let stream; let raf = 0; let stopped = false; let last = 0; let detector = null; let jsQR = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setError('This browser cannot open the camera here. Open the PlanetU app, or open this page over a secure link (https).'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch (err) {
        setError(err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
          ? 'Camera is blocked. Allow the camera for this app in your phone settings, then open Scan again.'
          : err?.name === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera could not be started.');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current; v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play().catch(() => {});
      setReady(true);
      if ('BarcodeDetector' in window) {
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      if (!detector) jsQR = (await import('jsqr')).default;
      loop();
    }

    async function loop(ts = 0) {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      const v = video.current;
      if (sent.current || !v || v.readyState < 2 || ts - last < 120) return;
      last = ts;
      let text = '';
      try {
        if (detector) {
          const found = await detector.detect(v);
          text = found?.[0]?.rawValue || '';
        } else {
          const c = canvas.current; const scale = Math.min(1, 640 / v.videoWidth);
          c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || '';
        }
      } catch { /* a frame that could not be read: try the next one */ }
      if (text && !sent.current) { sent.current = true; cb.current(text); }
    }

    start();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  return (
    <div className="scanner">
      <video ref={video} muted playsInline className="scanner__video" aria-label="Camera view" />
      <canvas ref={canvas} hidden />
      <div className="scanner__frame" aria-hidden="true" />
      {!ready && <p className="scanner__wait">Starting the camera...</p>}
    </div>
  );
}

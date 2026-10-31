import { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';

const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
/** The file name for a document: the end of its address, with the extension its type calls for. */
const nameOf = (url, type) => {
  const last = new URL(url, window.location.origin).pathname.split('/').pop() || 'document';
  return /\.[a-z0-9]+$/i.test(last) ? last : `${last}.${EXT[type] || 'pdf'}`;
};

/**
 * Only runs in the installed iPhone or iPad app. There a link with target="_blank" opens a separate browser that is not
 * signed in, and a link in the same window leaves the app with no way back. So every link to /api/ opens here instead,
 * with a Close button, and Save or share hands the file to the iPhone's own share sheet.
 */
export default function InstalledDocs() {
  const [url, setUrl] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      const to = new URL(a.href, window.location.origin);
      if (to.origin !== window.location.origin || !to.pathname.startsWith('/api/')) return;
      e.preventDefault();
      setUrl(to.pathname + to.search);
    };
    const onOpen = (e) => setUrl(e.detail.url);
    document.addEventListener('click', onClick, true);
    window.addEventListener('erp:open-document', onOpen);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('erp:open-document', onOpen); };
  }, []);

  useEffect(() => {
    setFile(null); setError('');
    if (!url) return undefined;
    let live = true;
    fetch(url, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Your session has ended. Close this and sign in again.' : 'This document could not be opened. Close this and try again.');
        const blob = await r.blob();
        if (live) setFile(new File([blob], nameOf(url, blob.type), { type: blob.type || 'application/pdf' }));
      })
      .catch((err) => { if (live) setError(err.message || 'This document could not be opened. Check your connection and try again.'); });
    return () => { live = false; };
  }, [url]);

  if (!url) return null;
  const canShare = file && navigator.canShare?.({ files: [file] });
  const share = async () => { try { await navigator.share({ files: [file] }); } catch { /* the person closed the share sheet */ } };
  const view = url.replace(/[?&]download=1$/, '');
  return (
    <div className="docview" role="dialog" aria-modal="true" aria-label="Document">
      <div className="docview__bar">
        <button type="button" className="btn btn--outline" onClick={() => setUrl(null)}><X size={16} /> Close</button>
        {canShare && <button type="button" className="btn btn--primary" onClick={share}><Share size={16} /> Save or share</button>}
      </div>
      {error
        ? <p className="docview__msg" role="alert">{error}</p>
        : <iframe className="docview__frame" title="Document" src={view} />}
    </div>
  );
}

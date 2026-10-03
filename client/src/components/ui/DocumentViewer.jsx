import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react';

const isImage = (name) => /\.(png|jpe?g)$/i.test(name || '');

/**
 * Shows a stored document on the page itself, so a reviewer can read it without it being saved to their computer.
 * `docs` is a list of { fileId, name, title }; `index` the one being shown. `actions(doc)` renders extra buttons
 * (for example Verify / Reject) under the document, so the decision can be made while looking at it.
 */
export default function DocumentViewer({ docs, index, onIndex, onClose, actions }) {
  const doc = docs[index];

  useEffect(() => {
    // Capture phase, so Escape closes only this viewer and not the dialog underneath it
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); }
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < docs.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, docs.length, onClose, onIndex]);

  if (!doc) return null;
  const src = `/api/files/${doc.fileId}`; // shown inline: no download is triggered
  return (
    <div className="modal-backdrop" style={{ zIndex: 2000 }} onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Viewing ${doc.title}`} style={{ maxWidth: 960, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3 style={{ minWidth: 0 }}>{doc.title}<span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {doc.name}</span></h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {docs.length > 1 && (
              <>
                <button type="button" className="icon-btn" aria-label="Previous document" disabled={index === 0} onClick={() => onIndex(index - 1)}><ChevronLeft size={18} /></button>
                <span className="muted" style={{ fontSize: 13 }}>{index + 1} / {docs.length}</span>
                <button type="button" className="icon-btn" aria-label="Next document" disabled={index === docs.length - 1} onClick={() => onIndex(index + 1)}><ChevronRight size={18} /></button>
              </>
            )}
            <a className="icon-btn" href={src} target="_blank" rel="noreferrer" aria-label="Open in a new tab" title="Open in a new tab"><ExternalLink size={17} /></a>
            <a className="icon-btn" href={`${src}?download=1`} aria-label="Download a copy" title="Download a copy"><Download size={17} /></a>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close viewer"><X size={18} /></button>
          </div>
        </div>
        <div className="modal__body" style={{ padding: 0, background: '#e5e7eb' }}>
          {isImage(doc.name)
            ? <div style={{ height: '70vh', display: 'grid', placeItems: 'center', overflow: 'auto' }}><img src={src} alt={doc.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>
            : <iframe key={doc.fileId} title={doc.title} src={src} style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }} />}
        </div>
        {actions && <div className="form-actions" style={{ margin: 0, padding: '12px 16px', justifyContent: 'space-between', flexWrap: 'wrap' }}>{actions(doc)}</div>}
      </div>
    </div>
  );
}

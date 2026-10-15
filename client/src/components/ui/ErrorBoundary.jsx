import { Component } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

const RELOADED = 'erp:chunk-reload';
// After a new version is deployed, an open tab may ask for a page file that no longer exists
const isChunkError = (err) => /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(String(err?.message || err));

/**
 * Catches an error while showing a page, so one broken page shows a short message with a Reload button instead of
 * a blank screen. If the error is an out-of-date page file (the site was updated while the tab was open), it
 * reloads once by itself to pick up the new version.
 */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) {
    if (isChunkError(error)) {
      let done = false;
      try { done = sessionStorage.getItem(RELOADED) === '1'; sessionStorage.setItem(RELOADED, '1'); } catch { /* storage blocked */ }
      if (!done) window.location.reload();
    }
  }

  componentDidUpdate(prev) {
    // Moving to another page clears the error
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) {
      try { sessionStorage.removeItem(RELOADED); } catch { /* storage blocked */ }
      return this.props.children;
    }
    const chunk = isChunkError(this.state.error);
    return (
      <div className="state state--error" role="alert" style={{ margin: '40px auto', maxWidth: 460 }}>
        <AlertCircle size={28} />
        <p><strong>{chunk ? 'A newer version of the app is available.' : 'This page could not be shown.'}</strong></p>
        <p className="muted">{chunk ? 'Reload to continue.' : 'Please reload. If it happens again, tell the institute office what you were doing.'}</p>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => window.location.reload()}><RefreshCw size={14} /> Reload</button>
      </div>
    );
  }
}

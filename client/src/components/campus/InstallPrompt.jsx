import { useEffect, useState } from 'react';

/** A small "Install app" button. Shown only when the browser says the app can be installed and it is not installed yet. */
export default function InstallPrompt({ className = 'btn btn--outline btn--sm' }) {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setEvt(e); };
    const onInstalled = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  if (!evt) return null;
  return (
    <button type="button" className={className} onClick={async () => { evt.prompt(); try { await evt.userChoice; } catch { /* ignore */ } setEvt(null); }}>
      Install app
    </button>
  );
}

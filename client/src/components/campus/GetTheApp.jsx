import { useState } from 'react';
import { Download, MonitorSmartphone, Share, SquarePlus, X } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import BrandMark from '../ui/BrandMark.jsx';
import { bannerClosed, closeBanner, useInstall } from '../../lib/install.js';

/** The buttons: install from the browser, download the Android app, or (iPhone) the steps to add it to the home screen. */
function Actions({ small = false }) {
  const { canInstall, install, apk, os } = useInstall();
  const [steps, setSteps] = useState(false);
  const size = small ? 'btn btn--sm' : 'btn';
  const anything = canInstall || apk || os === 'ios' || os === 'desktop';
  if (!anything) return null;
  return (
    <>
      <div className="getapp__actions">
        {canInstall && <button type="button" className={`${size} btn--primary`} onClick={install}><MonitorSmartphone size={15} /> {os === 'desktop' ? 'Install on this computer' : 'Install app'}</button>}
        {apk && os !== 'ios' && <a className={`${size} ${canInstall ? 'btn--outline' : 'btn--primary'}`} href="/get-app/android" download><Download size={15} /> Download Android app (APK)</a>}
        {os === 'ios' && <button type="button" className={`${size} btn--primary`} onClick={() => setSteps(true)}><SquarePlus size={15} /> Add to Home Screen</button>}
        {os === 'desktop' && !canInstall && <button type="button" className={`${size} btn--outline`} onClick={() => setSteps(true)}>How to install</button>}
      </div>
      <Modal open={steps} onClose={() => setSteps(false)} title="Install PlanetU on your device" width={420}>
        {os === 'ios' ? (
          <ol className="getapp__steps">
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button <Share size={14} style={{ verticalAlign: -2 }} /> at the bottom of the screen.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
            <li>Open <strong>PlanetU</strong> from your home screen like any other app.</li>
          </ol>
        ) : (
          <ol className="getapp__steps">
            <li>Open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.</li>
            <li>Click the small <strong>install</strong> icon at the right end of the address bar (or open the browser menu and choose <strong>Install PlanetU</strong>).</li>
            <li>Click <strong>Install</strong>. The app opens in its own window and gets a shortcut on your desktop or Start menu.</li>
          </ol>
        )}
        <div className="modal__actions"><button type="button" className="btn btn--primary" onClick={() => setSteps(false)}>Done</button></div>
      </Modal>
    </>
  );
}

/** A permanent "Get the app" box for the sign-in page. Hidden once the app is already installed. */
export function GetTheAppCard() {
  const { installed, apk, canInstall, os } = useInstall();
  if (installed) return null;
  const line = os === 'ios'
    ? 'Add PlanetU to your home screen to open it like an app.'
    : apk || canInstall ? 'Use PlanetU as an app: faster to open, with its own icon.' : 'Use PlanetU as an app on your phone or computer.';
  return (
    <section className="getapp" aria-label="Get the app">
      <span className="getapp__icon"><BrandMark size={22} /></span>
      <div className="getapp__text">
        <strong>Get the PlanetU app</strong>
        <p>{line}</p>
        <Actions />
      </div>
    </section>
  );
}

/** A slim banner along the top of the page that can be closed. It stays away for a week once closed. */
export function GetTheAppBanner() {
  const { installed, apk, canInstall, os } = useInstall();
  const [shut, setShut] = useState(bannerClosed);
  // Nothing to offer yet (a computer whose browser has not offered install, no APK): leave the card to explain
  if (installed || shut || !(apk || canInstall || os === 'ios')) return null;
  return (
    <div className="getapp-banner" role="region" aria-label="App available">
      <span className="getapp-banner__text">{apk && os !== 'ios' ? 'The PlanetU app is available. Install it or download the Android APK.' : 'The PlanetU app is available. Add it to your device.'}</span>
      <Actions small />
      <button type="button" className="icon-btn" aria-label="Close" onClick={() => { closeBanner(); setShut(true); }}><X size={16} /></button>
    </div>
  );
}

import { useState } from 'react';
import { Download, MonitorSmartphone, SquarePlus, X } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import BrandMark from '../ui/BrandMark.jsx';
import InstallSteps, { installTitle } from './InstallSteps.jsx';
import { bannerClosed, closeBanner, useInstall } from '../../lib/install.js';

/** The steps for this device, in a dialog. Safari never offers an install button, so iPhone and Mac Safari always need it. */
export function InstallSheet({ open, onClose, route, device }) {
  return (
    <Modal open={open} onClose={onClose} title={installTitle(route, device)} width={420}>
      <InstallSteps route={route} device={device} />
      <div className="modal__actions"><button type="button" className="btn btn--primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

/** The buttons: install from the browser, download the Android app, or the steps for this device. */
function Actions({ small = false }) {
  const { canInstall, install, apk, os, device, route } = useInstall();
  const [steps, setSteps] = useState(false);
  const size = small ? 'btn btn--sm' : 'btn';
  const anything = canInstall || apk || os === 'ios' || os === 'desktop';
  if (!anything) return null;
  return (
    <>
      <div className="getapp__actions">
        {canInstall && <button type="button" className={`${size} btn--primary`} onClick={install}><MonitorSmartphone size={15} /> {os === 'desktop' ? 'Install on this computer' : 'Install app'}</button>}
        {apk && os === 'android' && <a className={`${size} ${canInstall ? 'btn--outline' : 'btn--primary'}`} href="/get-app/android" download><Download size={15} /> Download Android app (APK)</a>}
        {os === 'ios' && <button type="button" className={`${size} btn--primary`} onClick={() => setSteps(true)}><SquarePlus size={15} /> Install on {device}</button>}
        {route === 'mac-dock' && <button type="button" className={`${size} btn--primary`} onClick={() => setSteps(true)}><SquarePlus size={15} /> Add to Dock</button>}
        {os === 'desktop' && route !== 'mac-dock' && !canInstall && <button type="button" className={`${size} btn--outline`} onClick={() => setSteps(true)}>How to install</button>}
        {apk && os === 'desktop' && <a className={`${size} btn--outline`} href="/get-app/android" download><Download size={15} /> Android app (APK)</a>}
      </div>
      <InstallSheet open={steps} onClose={() => setSteps(false)} route={route} device={device} />
    </>
  );
}

/** A permanent "Get the app" box for the sign-in page. Hidden once the app is already installed. */
export function GetTheAppCard() {
  const { installed, apk, canInstall, os, device, route } = useInstall();
  if (installed) return null;
  const line = os === 'ios'
    ? `Add PlanetU to your ${device} home screen to open it like an app.`
    : route === 'mac-dock' ? 'In Safari, choose File, then Add to Dock, to open PlanetU in its own window.'
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

/** A slim banner along the top of the page that can be closed. It stays away for 14 days once closed, and it sits above the form, never over it. */
export function GetTheAppBanner() {
  const { installed, apk, canInstall, os, device } = useInstall();
  const [shut, setShut] = useState(bannerClosed);
  // Nothing to offer yet (a computer whose browser has not offered install, no APK): leave the card to explain
  if (installed || shut || !(apk || canInstall || os === 'ios')) return null;
  return (
    <div className="getapp-banner" role="region" aria-label="App available">
      <span className="getapp-banner__text">{os === 'ios' ? `The PlanetU app is available on your ${device}.` : apk ? 'The PlanetU app is available. Install it or download the Android APK.' : 'The PlanetU app is available. Add it to your device.'}</span>
      <Actions small />
      <button type="button" className="icon-btn" aria-label="Close" onClick={() => { closeBanner(); setShut(true); }}><X size={16} /></button>
    </div>
  );
}

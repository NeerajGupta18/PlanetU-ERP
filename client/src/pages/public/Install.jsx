import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Download, Laptop, MonitorSmartphone, Smartphone, Tablet } from 'lucide-react';
import { BRAND } from '../../config/brand.js';
import BrandMark from '../../components/ui/BrandMark.jsx';
import InstallSteps from '../../components/campus/InstallSteps.jsx';
import { useInstall } from '../../lib/install.js';
import './install.css';

/** One way of installing. The card for this device is marked; on a phone the others stay folded until opened. */
function DeviceCard({ id, icon: Icon, title, lead, here, open, children }) {
  return (
    <section id={id} className={`install-card ${here ? 'is-here' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="install-card__head">
        <span className="install-card__icon"><Icon size={22} aria-hidden="true" /></span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {here && <p className="install-card__here"><CheckCircle2 size={14} aria-hidden="true" /> This device</p>}
        </div>
      </div>
      <p className="install-card__lead">{lead}</p>
      <details className="install-card__more" open={open}>
        <summary>Show the steps <ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="install-card__body">{children}</div>
      </details>
    </section>
  );
}

/** The public page that says how to get the app on each kind of device. */
export default function Install() {
  const { installed, apk, canInstall, install, os, device, route } = useInstall();
  const { hash } = useLocation();
  const isOpen = (id, here) => os === 'desktop' || here || hash === `#${id}`;

  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView();
  }, [hash]);

  const android = (
    <DeviceCard key="android" id="android" icon={Smartphone} title="Android" lead="A small app with its own icon." here={os === 'android'} open={isOpen('android', os === 'android')}>
      {os === 'android' && canInstall && <button type="button" className="btn btn--primary" onClick={install}><MonitorSmartphone size={16} aria-hidden="true" /> Install app</button>}
      {apk
        ? (
          <>
            <a className={`btn ${os === 'android' && canInstall ? 'btn--outline' : 'btn--primary'}`} href="/get-app/android" download><Download size={16} aria-hidden="true" /> Download Android app (APK)</a>
            <ol className="install-sheet__steps install-card__steps">
              <li><span>Open the downloaded file on the phone.</span></li>
              <li><span>Android asks once to allow installs from your browser or files app. Allow it.</span></li>
              <li><span>Tap <strong>Install</strong>, then open PlanetU.</span></li>
            </ol>
          </>
        )
        : <p className="muted">The Android download is not available right now. Please try again later, or use PlanetU in your phone's browser.</p>}
    </DeviceCard>
  );
  const ios = (
    <DeviceCard key="iphone" id="iphone" icon={Tablet} title="iPhone and iPad" lead="Free, takes a few seconds, and needs no App Store." here={os === 'ios'} open={isOpen('iphone', os === 'ios')}>
      <InstallSteps route="ios-share" device={os === 'ios' ? device : 'any'} />
    </DeviceCard>
  );
  const computer = (
    <DeviceCard key="computer" id="computer" icon={Laptop} title="Computer" lead="Opens in its own window, with its own icon." here={os === 'desktop'} open={isOpen('computer', os === 'desktop')}>
      {os === 'desktop' && canInstall && <button type="button" className="btn btn--primary" onClick={install}><MonitorSmartphone size={16} aria-hidden="true" /> Install on this computer</button>}
      <InstallSteps route={os === 'desktop' ? route : 'desktop-prompt'} />
      {route !== 'mac-dock' && <p className="install-sheet__note">In Safari on a Mac, choose File, then Add to Dock.</p>}
    </DeviceCard>
  );
  // This device first, then the others
  const cards = os === 'ios' ? [ios, android, computer] : os === 'android' ? [android, ios, computer] : [computer, android, ios];

  return (
    <div className="site install-page">
      <header className="site-nav">
        <Link to="/" className="site-nav__brand"><BrandMark size={28} /> <span>{BRAND.short} Campus ERP</span></Link>
        <Link to="/login" className="btn btn--outline btn--sm install-page__signin">Sign in</Link>
      </header>
      <main className="install-page__main">
        <h1>Get the app</h1>
        {installed
          ? <p className="install-page__lead">You are already using the PlanetU app on this device. <Link to="/login">Go to sign in</Link>.</p>
          : (
            <>
              <p className="install-page__lead">PlanetU works in any browser. Installing it gives you an icon that opens straight to your own screen.</p>
              <div className="install-page__layout">
                <div className="install-page__cards">{cards}</div>
                {os === 'desktop' && (
                  <aside className="install-qr" aria-label="Open this page on your phone">
                    <img src="/install-qr.svg" width="168" height="168" alt="QR code that opens this page on your phone" />
                    <p>Installing on a phone? Point its camera here to open this page.</p>
                  </aside>
                )}
              </div>
            </>
          )}
        <p className="install-page__foot"><Link to="/">Home</Link> · <Link to="/login">Sign in</Link> · <Link to="/privacy">Privacy notice</Link></p>
      </main>
    </div>
  );
}

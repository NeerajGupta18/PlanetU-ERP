import { SquarePlus } from 'lucide-react';

/** A drawing of the iPhone Share button: a box with an arrow going up out of it. */
export function ShareIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9.5H6.5A1.5 1.5 0 0 0 5 11v8.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V11a1.5 1.5 0 0 0-1.5-1.5H16" />
      <path d="M12 15V3" />
      <path d="M8.5 6.2 12 2.8l3.5 3.4" />
    </svg>
  );
}

/** The real steps for this way of installing (see lib/platform.js). No wording here may send an iPhone to another browser. */
export default function InstallSteps({ route, device = 'iPhone' }) {
  if (route === 'ios-share') {
    return (
      <div className="install-sheet">
        <ol className="install-sheet__steps">
          <li><span>Tap the <strong>Share</strong> button <span className="install-sheet__icon"><ShareIcon /></span> {device === 'iPad' ? 'at the top of the screen.' : 'at the bottom of the screen.'}</span></li>
          <li><span>Scroll down and choose <strong>Add to Home Screen</strong> <span className="install-sheet__icon"><SquarePlus size={18} aria-hidden="true" /></span></span></li>
          <li><span>Tap <strong>Add</strong>. PlanetU now opens from your home screen like any other app.</span></li>
        </ol>
      </div>
    );
  }
  if (route === 'mac-dock') {
    return (
      <div className="install-sheet">
        <ol className="install-sheet__steps">
          <li><span>In the Safari menu bar, open <strong>File</strong>.</span></li>
          <li><span>Choose <strong>Add to Dock</strong>, then click <strong>Add</strong>.</span></li>
          <li><span>PlanetU now opens from the Dock in its own window.</span></li>
        </ol>
        <p className="install-sheet__note">Add to Dock needs Safari 17 or newer on macOS Sonoma or newer.</p>
      </div>
    );
  }
  if (route === 'desktop-other') {
    return (
      <div className="install-sheet">
        <p className="install-sheet__lead">This browser cannot install apps. PlanetU still works fully right here, or you can install it from another browser:</p>
        <ol className="install-sheet__steps">
          <li><span>Open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.</span></li>
          <li><span>Click the small <strong>install</strong> icon at the right end of the address bar.</span></li>
          <li><span>Click <strong>Install</strong>. The app opens in its own window.</span></li>
        </ol>
      </div>
    );
  }
  return (
    <div className="install-sheet">
      <ol className="install-sheet__steps">
        <li><span>Click the small <strong>install</strong> icon at the right end of the address bar, or open the browser menu and choose <strong>Install PlanetU</strong>.</span></li>
        <li><span>Click <strong>Install</strong>. The app opens in its own window and gets a shortcut on your desktop or Start menu.</span></li>
      </ol>
    </div>
  );
}

/** The title that goes with those steps. */
export function installTitle(route, device = 'iPhone') {
  if (route === 'ios-share') return `Install on ${device}`;
  if (route === 'mac-dock') return 'Add to Dock';
  return 'Install on this computer';
}

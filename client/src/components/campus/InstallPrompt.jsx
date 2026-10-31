import { Suspense, lazy } from 'react';
import { platform, useInstall } from '../../lib/install.js';

const Sheet = lazy(() => import('./GetTheApp.jsx').then((m) => ({ default: m.InstallSheet })));

/**
 * The install line for a menu. One tap where the browser can install (Android Chrome, desktop Chrome and Edge). On iPhone,
 * iPad and Mac Safari, which never offer an install prompt, it calls `onSteps`. Nothing once installed. A menu closes on
 * any click, so the steps must live outside it: the menu's owner renders <InstallStepsSheet>.
 */
export default function InstallPrompt({ className = 'btn btn--outline btn--sm', onSteps }) {
  const { installed, canInstall, install, os, device, route } = useInstall();
  if (installed) return null;
  if (canInstall) return <button type="button" className={className} onClick={install}>Install app</button>;
  if (os !== 'ios' && route !== 'mac-dock') return null;
  return <button type="button" className={className} onClick={onSteps}>{os === 'ios' ? `Install on ${device}` : 'Add to Dock'}</button>;
}

/** The steps for this device, loaded only when asked for. */
export function InstallStepsSheet({ open, onClose }) {
  if (!open) return null;
  const { route, device } = platform();
  return <Suspense fallback={null}><Sheet open onClose={onClose} route={route} device={device} /></Suspense>;
}

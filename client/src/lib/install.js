// Install support. The browser fires "beforeinstallprompt" very early (often before a page has loaded), so it is
// caught here, once, from main.jsx, and handed to whichever screen asks for it later.
import { useEffect, useState } from 'react';
import { detectPlatform, dismissalActive } from './platform.js';

let deferred = null;
const listeners = new Set();
const tell = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; tell(); });
  window.addEventListener('appinstalled', () => { deferred = null; tell(); });
}

/** This device, its browser and its way of installing. See platform.js. */
export function platform() {
  return detectPlatform({ ua: navigator.userAgent || '', maxTouchPoints: navigator.maxTouchPoints || 0 });
}

/** Already running as an installed app (home-screen app, desktop app window or the APK itself). */
export function isInstalled() {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true;
    if (window.navigator.standalone) return true;
    if (window.Capacitor?.isNativePlatform?.()) return true;
    if (/PlanetUApp/.test(navigator.userAgent)) return true;
  } catch { /* ignore */ }
  return false;
}

/** Everything a screen needs to offer the app: can the browser install it, is the APK there, is it installed already. */
export function useInstall() {
  const [, force] = useState(0);
  const [apk, setApk] = useState(false);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  useEffect(() => {
    let live = true;
    fetch('/api/app/info').then((r) => r.json()).then((d) => { if (live) setApk(Boolean(d.android)); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const install = async () => {
    if (!deferred) return false;
    const evt = deferred;
    evt.prompt();
    let accepted = false;
    try { accepted = (await evt.userChoice).outcome === 'accepted'; } catch { /* ignore */ }
    deferred = null; tell();
    return accepted;
  };
  const { os, device, route } = platform();
  return { installed: isInstalled(), canInstall: Boolean(deferred), install, apk, os, device, route };
}

const KEY = 'erp.installBanner';
/** The banner stays away for 14 days after it is closed. */
export function bannerClosed() {
  try { return dismissalActive(localStorage.getItem(KEY)); } catch { return false; }
}
export function closeBanner() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
}

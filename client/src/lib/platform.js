// Which device and browser is this, and how can it install the app? A plain function with no browser or React
// imports, so the tests can run it with real user-agent strings (server/test/installPlatform.test.js).

/**
 * @param {{ ua?: string, maxTouchPoints?: number }} env
 * @returns {{ os: 'ios'|'android'|'desktop', device: 'iPhone'|'iPad'|'Android'|'Computer', browser: string, route: 'ios-share'|'android-prompt'|'mac-dock'|'desktop-prompt'|'desktop-other' }}
 */
export function detectPlatform({ ua = '', maxTouchPoints = 0 } = {}) {
  // iPadOS Safari asks for desktop pages and calls itself a Mac. Only the touch points give it away.
  const macTouch = /Macintosh/.test(ua) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || macTouch) {
    // Every iOS browser is WebKit underneath, and all of them install through the Share button
    const browser = /CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : 'safari';
    return { os: 'ios', device: /iPad/.test(ua) || macTouch ? 'iPad' : 'iPhone', browser, route: 'ios-share' };
  }
  const browser = /Edg(e|A)?\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : /Firefox\//.test(ua) ? 'firefox'
    : /Chrome\/|Chromium\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  if (/Android/.test(ua)) return { os: 'android', device: 'Android', browser, route: 'android-prompt' };
  if (browser === 'safari' && /Macintosh/.test(ua)) return { os: 'desktop', device: 'Computer', browser, route: 'mac-dock' };
  if (browser === 'chrome' || browser === 'edge') return { os: 'desktop', device: 'Computer', browser, route: 'desktop-prompt' };
  return { os: 'desktop', device: 'Computer', browser, route: 'desktop-other' };
}

const DAY = 24 * 3600 * 1000;
/** How long the install banner stays away once it is closed. */
export const DISMISS_DAYS = 14;

/** True while a dismissal stored at `closedAt` (milliseconds, or nothing) still holds at time `now`. */
export function dismissalActive(closedAt, now = Date.now()) {
  const at = Number(closedAt);
  if (!at) return false;
  return now - at < DISMISS_DAYS * DAY;
}

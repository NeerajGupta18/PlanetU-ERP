/** How each device installs the app (client/src/lib/platform.js), with real user-agent strings - run with `npm test`. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISMISS_DAYS, detectPlatform, dismissalActive } from '../../client/src/lib/platform.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/129.0.2792.84 Mobile/15E148 Safari/604.1',
  oldIpad: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  // iPadOS and Mac Safari send the very same string; only the touch points differ
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.81 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

describe('install platform', () => {
  it('sends iPhone Safari to the Share button', () => {
    assert.deepEqual(detectPlatform({ ua: UA.iphoneSafari, maxTouchPoints: 5 }), { os: 'ios', device: 'iPhone', browser: 'safari', route: 'ios-share' });
  });
  it('sends Chrome, Firefox and Edge on iPhone to the Share button too, because they are WebKit', () => {
    for (const [ua, browser] of [[UA.iphoneChrome, 'chrome'], [UA.iphoneFirefox, 'firefox'], [UA.iphoneEdge, 'edge']]) {
      assert.deepEqual(detectPlatform({ ua, maxTouchPoints: 5 }), { os: 'ios', device: 'iPhone', browser, route: 'ios-share' });
    }
  });
  it('knows an iPad, including one that reports itself as a Mac', () => {
    assert.equal(detectPlatform({ ua: UA.oldIpad, maxTouchPoints: 5 }).device, 'iPad');
    const ipadOs = detectPlatform({ ua: UA.macSafari, maxTouchPoints: 5 });
    assert.equal(ipadOs.device, 'iPad');
    assert.equal(ipadOs.route, 'ios-share');
  });
  it('sends Safari on a real Mac to Add to Dock', () => {
    for (const maxTouchPoints of [0, 1]) {
      assert.deepEqual(detectPlatform({ ua: UA.macSafari, maxTouchPoints }), { os: 'desktop', device: 'Computer', browser: 'safari', route: 'mac-dock' });
    }
  });
  it('keeps the one-tap install on Android Chrome', () => {
    assert.deepEqual(detectPlatform({ ua: UA.androidChrome, maxTouchPoints: 5 }), { os: 'android', device: 'Android', browser: 'chrome', route: 'android-prompt' });
  });
  it('keeps the browser install on desktop Chrome and Edge, and is not fooled by Safari in their strings', () => {
    assert.equal(detectPlatform({ ua: UA.macChrome }).route, 'desktop-prompt');
    assert.equal(detectPlatform({ ua: UA.winChrome }).route, 'desktop-prompt');
    const edge = detectPlatform({ ua: UA.winEdge });
    assert.equal(edge.browser, 'edge');
    assert.equal(edge.route, 'desktop-prompt');
  });
  it('treats a desktop browser that cannot install as its own case', () => {
    assert.equal(detectPlatform({ ua: UA.winFirefox }).route, 'desktop-other');
    assert.equal(detectPlatform().route, 'desktop-other');
  });
});

describe('closing the install banner', () => {
  const now = Date.UTC(2026, 9, 31);
  const day = 24 * 3600 * 1000;
  it('stays closed for 14 days', () => {
    assert.equal(DISMISS_DAYS, 14);
    assert.equal(dismissalActive(now - 13 * day, now), true);
    assert.equal(dismissalActive(String(now - 13 * day), now), true);
  });
  it('comes back after 14 days', () => {
    assert.equal(dismissalActive(now - 14 * day, now), false);
  });
  it('shows when it was never closed or the stored value is junk', () => {
    for (const v of [null, undefined, '', 'not a number', 0]) assert.equal(dismissalActive(v, now), false);
  });
});

/**
 * Fingerprint sign-in, in the Android app only. The app wraps this website, and its native fingerprint plugin
 * (@capgo/capacitor-native-biometric, see android-app/package.json) is reached through the bridge Capacitor injects
 * as window.Capacitor - nothing extra is bundled here, and in a browser or the iPhone web app every check is false.
 *
 * The phone keeps one sign-in token per saved account in Android Keystore-backed storage and reads it only after
 * the fingerprint prompt succeeds. The password is never stored. The list of saved accounts (names and IDs, no
 * secrets) lives in localStorage so the sign-in page can show it.
 */
import { api } from '../api/http.js';

const PLUGIN = 'NativeBiometric';
const ACCOUNTS = 'planetu.fp.accounts';
const DECLINED = 'planetu.fp.declined';
export const MAX_SAVED = 5;

const cap = () => window.Capacitor;
const call = (method, options = {}) => cap().nativePromise(PLUGIN, method, options);
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const server = (key) => `planetu.erp.${key}`;

/** Only inside an Android app build that carries the fingerprint plugin (older APKs simply do not offer it). */
export function fingerprintPossible() {
  const c = cap();
  return Boolean(c?.isNativePlatform?.() && c.getPlatform?.() === 'android' && typeof c.nativePromise === 'function'
    && (c.PluginHeaders || []).some((p) => p.name === PLUGIN));
}

/** True when the phone has a fingerprint (or other strong biometric) enrolled. */
export async function fingerprintReady() {
  if (!fingerprintPossible()) return false;
  try { return Boolean((await call('isAvailable', { useFallback: false })).isAvailable); } catch { return false; }
}

/** The account key: the same login ID in two institutes is two different people. */
export const accountKey = (tenantCode, user) => `${tenantCode}:${user.id}`;

export const savedAccounts = () => read(ACCOUNTS, []).filter((a) => a && a.key && a.tenantCode);
const saveList = (list) => write(ACCOUNTS, list.slice(0, MAX_SAVED));
export const isSaved = (key) => savedAccounts().some((a) => a.key === key);

export const hasDeclined = (key) => read(DECLINED, []).includes(key);
export const setDeclined = (key, yes) => {
  const list = read(DECLINED, []).filter((k) => k !== key);
  write(DECLINED, yes ? [...list, key] : list);
};

/** Should "Use fingerprint next time" be offered to this person, right after their password sign-in? */
export const shouldOffer = (tenantCode, user) => Boolean(tenantCode && user && user.role !== 'super_admin'
  && !isSaved(accountKey(tenantCode, user)) && !hasDeclined(accountKey(tenantCode, user)) && savedAccounts().length < MAX_SAVED);

/** Turns fingerprint on for the signed-in account on this phone (needs a password sign-in in the last 15 minutes). */
export async function enableFingerprint(tenantCode, user, institute) {
  const key = accountKey(tenantCode, user);
  // Ask for the finger once now, so the person knows it works before they rely on it
  await call('verifyIdentity', { title: 'Use fingerprint to sign in', subtitle: user.name, negativeButtonText: 'Cancel', maxAttempts: 3 });
  const d = await api.post('/auth/devices', { label: deviceLabel() });
  await call('setCredentials', { server: server(key), username: user.loginId, password: d.token });
  setDeclined(key, false);
  saveList([{ key, tenantCode, name: user.name, loginId: user.loginId, role: user.role, institute: institute || '' },
    ...savedAccounts().filter((a) => a.key !== key)]);
}

/** Fingerprint, then the token, then a session. Returns the same session object as a password sign-in. */
export async function unlockWithFingerprint(account) {
  try {
    await call('verifyIdentity', {
      title: 'Sign in to PlanetU', subtitle: `${account.name} (${account.loginId})`, negativeButtonText: 'Use password instead', maxAttempts: 3,
    });
  } catch (err) {
    // 16 = the person tapped "Use password instead" (the plugin's "user cancel" code)
    if (String(err?.code) === '16') throw Object.assign(new Error(''), { code: 'USE_PASSWORD' });
    throw Object.assign(new Error('Fingerprint not recognised. Try again, or use your password.'), { code: 'NOT_VERIFIED' });
  }
  let token;
  try { token = (await call('getCredentials', { server: server(account.key) })).password; } catch { token = null; }
  if (!token) {
    removeSaved(account.key);
    throw Object.assign(new Error('Fingerprint sign-in is not set up on this phone any more. Please sign in with your password.'), { code: 'DEVICE_INVALID' });
  }
  try {
    return await api.post('/auth/device-login', { tenantCode: account.tenantCode, token });
  } catch (err) {
    // Expired, removed, or the password changed: forget it here too, and the person signs in with the password
    if (err.data?.code === 'DEVICE_INVALID' || err.data?.code === 'DEVICE_EXPIRED') await dropToken(account.key);
    throw err;
  }
}

async function dropToken(key) {
  try { await call('deleteCredentials', { server: server(key) }); } catch { /* already gone */ }
  removeSaved(key);
}
const removeSaved = (key) => saveList(savedAccounts().filter((a) => a.key !== key));

/** "Forget this phone": the server stops trusting the token, and the phone deletes it. */
export async function forgetAccount(key) {
  const account = savedAccounts().find((a) => a.key === key);
  if (!account) return;
  try {
    const token = (await call('getCredentials', { server: server(key) })).password;
    if (token) await api.post('/auth/devices/forget', { tenantCode: account.tenantCode, token });
  } catch { /* offline or already gone: the phone still deletes it, and the server copy expires */ }
  await dropToken(key);
}

function deviceLabel() {
  const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/);
  const model = m?.[1]?.replace(/Build\/.*/, '').trim();
  return model && model !== 'K' ? `${model} (Android app)` : 'Android phone (app)';
}

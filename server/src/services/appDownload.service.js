import { env } from '../config/env.js';

const DEFAULT_URL = 'https://github.com/NeerajGupta18/planetu-erp/releases/latest/download/planetu-erp.apk';
const FOUND_MS = 10 * 60 * 1000; // a found file is re-checked every ten minutes
const MISSING_MS = 2 * 60 * 1000; // a missing one sooner, so the button appears soon after the build finishes

let cache = { at: 0, ok: false };

export const apkUrl = () => (env.APK_URL && env.APK_URL !== 'off' ? env.APK_URL : DEFAULT_URL);

/** True when the APK can be downloaded right now. Checked with a quick HEAD request and remembered for a few minutes. */
export async function apkAvailable(fetchImpl = fetch) {
  if (env.APK_URL === 'off') return false;
  const age = Date.now() - cache.at;
  if (cache.at && age < (cache.ok ? FOUND_MS : MISSING_MS)) return cache.ok;
  let ok = false;
  try {
    const r = await fetchImpl(apkUrl(), { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) });
    ok = r.ok;
  } catch { ok = false; }
  cache = { at: Date.now(), ok };
  return ok;
}

/** For tests: forget what was remembered. */
export function resetApkCache() { cache = { at: 0, ok: false }; }

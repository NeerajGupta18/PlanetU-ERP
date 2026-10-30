/**
 * A very short memory for dashboard answers, so a page opened by several tabs or refreshed a few times does not repeat
 * the aggregates. Always kept per person inside their institute (never shared), and at most 60 seconds old.
 */
const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 500;
const store = new Map();

export async function cachedDashboard({ tenantId, userId, kind, fresh = false }, build) {
  const key = `${tenantId ?? 'platform'}|${userId}|${kind}`;
  const hit = store.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = { ...(await build()), generatedAt: new Date().toISOString() };
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.delete(key);
  store.set(key, { at: Date.now(), value });
  return value;
}

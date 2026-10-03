import { env } from '../config/env.js';
import { q, withTx } from '../db/pool.js';
import { getTransport } from '../mail/transport.js';
import { templates } from '../mail/templates.js';

const MAX_ATTEMPTS = 5;

/** Queues an email inside the current transaction (so it only exists if the request succeeds). */
export async function queueEmail(to, template, data) {
  const built = templates[template](data);
  await q(
    'insert into notifications (to_email, template, subject, text_body, html_body) values ($1, $2, $3, $4, $5)',
    [to, template, built.subject.replace(/[\r\n]+/g, ' '), built.text, built.html],
  );
}

/** Current tenant's code + display name, for links and sender names. Null for platform-level mail. */
export async function tenantInfo() {
  const { rows: [t] } = await q(
    `select t.code, coalesce(ip.name, t.name) as name from tenants t
     left join institute_profiles ip on ip.tenant_id = t.id where t.id = app_tenant()`,
  );
  return t || { code: null, name: 'PlanetU ERP' };
}

const safeName = (n) => String(n).replace(/[\r\n"\\<>]+/g, ' ').trim() || 'PlanetU ERP';

async function drain(transport, batch) {
  let sent = 0; let failed = 0;
  const { rows } = await q(
    `select n.id, n.to_email as "to", n.subject, n.text_body as text, n.html_body as html, n.attempts,
            coalesce(ip.name, 'PlanetU ERP') as sender
     from notifications n left join institute_profiles ip on ip.tenant_id = n.tenant_id
     where n.status = 'queued' and n.next_attempt_at <= now()
     order by n.created_at limit $1 for update of n skip locked`, [batch],
  );
  for (const m of rows) {
    try {
      await transport.sendMail({ from: `"${safeName(m.sender)}" <${env.MAIL_FROM_ADDRESS}>`, to: m.to, subject: m.subject, text: m.text, html: m.html });
      await q("update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null where id = $1", [m.id]);
      sent += 1;
    } catch (err) {
      const attempts = m.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await q(
        `update notifications set attempts = $2, status = $3, last_error = $4,
           next_attempt_at = now() + make_interval(mins => $5) where id = $1`,
        [m.id, attempts, dead ? 'failed' : 'queued', String(err.message).slice(0, 300), attempts * attempts],
      );
      if (dead) failed += 1;
    }
  }
  return { sent, failed };
}

/**
 * Delivers queued mail for every institute (and platform-level mail). Each institute is processed in its own
 * tenant context, so the worker never has cross-tenant access. Failed sends retry with growing delays.
 */
export async function processQueue({ batch = 25 } = {}) {
  const transport = getTransport();
  const ids = (await withTx({ platform: true }, async () => (await q("select id from tenants where status = 'active'")).rows)).map((r) => r.id);
  const total = { sent: 0, failed: 0 };
  for (const ctx of [{ platform: true }, ...ids.map((tenantId) => ({ tenantId }))]) {
    const r = await withTx(ctx, () => drain(transport, batch));
    total.sent += r.sent; total.failed += r.failed;
  }
  return total;
}

let timer;
export function startMailWorker(intervalMs = 15000) {
  if (timer) return;
  const tick = () => processQueue().catch((err) => console.error('[mail] worker error:', err.message));
  timer = setInterval(tick, intervalMs);
  timer.unref();
}
export function stopMailWorker() { clearInterval(timer); timer = undefined; }

import { env } from '../config/env.js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { inTenant, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { MODULES, PRESETS, TENANT_TYPES, normaliseModules } from '../config/modules.js';
import { provisionTenant } from '../services/tenant.service.js';
import { sendSetupLink } from '../services/accounts.service.js';
import { switchTenant } from '../db/pool.js';
import { startSubscription, updateSubscription } from '../services/billing.service.js';

/**
 * The vendor console. These handlers run in PLATFORM context: they may read the
 * tenant list and users, but NOT clients' business data (students, fees...).
 * Per-client counts deliberately switch into each tenant explicitly.
 */

const PLANS = ['trial', 'basic', 'standard', 'premium', 'demo'];

const TENANT_COLUMNS = `id, code, name, type, status, plan, modules, terminology, settings, created_at as "createdAt"`;

async function withCounts(tenants) {
  const { rows: users } = await q('select tenant_id, count(*)::int as n from users where tenant_id is not null group by tenant_id');
  const userCount = new Map(users.map((u) => [u.tenant_id, u.n]));
  const out = [];
  for (const t of tenants) {
    const counts = await inTenant(t.id, async () => {
      const { rows: [r] } = await q('select (select count(*) from students)::int as students, (select count(*) from employees)::int as employees');
      return r;
    });
    out.push({ ...t, ...counts, users: userCount.get(t.id) || 0 });
  }
  return out;
}

export function presets(req, res) {
  res.json({
    modules: MODULES,
    types: TENANT_TYPES.map((key) => ({ key, ...PRESETS[key] })),
    plans: PLANS,
  });
}

export async function dashboard(req, res) {
  const { rows: [t] } = await q(`
    select count(*)::int as total,
           count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'suspended')::int as suspended,
           count(*) filter (where settings->>'demo' = 'true')::int as demo
    from tenants`);
  const { rows: byType } = await q('select type, count(*)::int as n from tenants group by type order by type');
  const { rows: [u] } = await q('select count(*)::int as n from users where tenant_id is not null');
  const { rows: recent } = await q(`select ${TENANT_COLUMNS} from tenants order by created_at desc limit 5`);
  res.json({ stats: { ...t, users: u.n }, byType, recent });
}

export async function listTenants(req, res) {
  const { rows } = await q(`select ${TENANT_COLUMNS} from tenants order by created_at, name`);
  res.json({ tenants: await withCounts(rows) });
}

export async function getTenant(req, res) {
  const { rows: [t] } = await q(`select ${TENANT_COLUMNS} from tenants where id = $1`, [req.params.id]);
  if (!t) throw new HttpError(404, 'Institute not found.');
  res.json({ tenant: (await withCounts([t]))[0] });
}

export async function createTenant(req, res) {
  const { code, name, type, plan, modules, admin } = req.body || {};
  if (plan && !PLANS.includes(plan)) throw new HttpError(400, `Plan must be one of: ${PLANS.join(', ')}.`);
  const result = await provisionTenant({
    code: String(code || '').trim().toLowerCase(), name, type, plan, modules,
    admin: { name: admin?.name, email: admin?.email, loginId: admin?.loginId || 'ADM001' },
  });
  await audit(req.user, 'tenant.create', 'tenant', result.tenantId, { code, type });
  const { rows: [t] } = await q(`select ${TENANT_COLUMNS} from tenants where id = $1`, [result.tenantId]);
  // The one-time password is shown once here and never stored in plain text
  res.status(201).json({ tenant: t, admin: result.admin });
}

export async function updateTenant(req, res) {
  const { rows: [cur] } = await q(`select ${TENANT_COLUMNS} from tenants where id = $1`, [req.params.id]);
  if (!cur) throw new HttpError(404, 'Institute not found.');
  const { name, plan, status, modules, terminology } = req.body || {};
  if (plan && !PLANS.includes(plan)) throw new HttpError(400, `Plan must be one of: ${PLANS.join(', ')}.`);
  if (status && !['active', 'suspended'].includes(status)) throw new HttpError(400, 'Status must be active or suspended.');
  if (modules && !Array.isArray(modules)) throw new HttpError(400, 'Modules must be a list.');

  await q(
    `update tenants set name = $1, plan = $2, status = $3, modules = $4, terminology = $5,
            suspension_reason = case when $3 = 'active' then null when status <> $3 then 'manual' else suspension_reason end
     where id = $6`,
    [name?.trim() || cur.name, plan ?? cur.plan, status ?? cur.status,
      modules ? normaliseModules(modules) : cur.modules, { ...cur.terminology, ...(terminology || {}) }, req.params.id],
  );
  // The plan lives in the subscription now: keep the two in step (a plan change applies from the next invoice)
  if (plan && plan !== cur.plan && plan !== 'demo') {
    const { rowCount } = await q('select 1 from tenant_subscriptions where tenant_id = $1', [req.params.id]);
    if (rowCount) await updateSubscription(req.params.id, { planKey: plan }, req.user);
    else await startSubscription(req.params.id, plan);
  }
  await audit(req.user, 'tenant.update', 'tenant', req.params.id, {
    ...(status && status !== cur.status ? { status } : {}), ...(plan && plan !== cur.plan ? { plan } : {}),
    ...(modules ? { modules: normaliseModules(modules).length } : {}),
  });
  const { rows: [t] } = await q(`select ${TENANT_COLUMNS} from tenants where id = $1`, [req.params.id]);
  res.json({ tenant: (await withCounts([t]))[0] });
}

// Support tool: issue a new one-time password for the institute's first admin
export async function resetAdminPassword(req, res) {
  const { rows: [a] } = await q(
    "select id, name, login_id as \"loginId\", email from users where tenant_id = $1 and role = 'admin' order by created_at limit 1",
    [req.params.id],
  );
  if (!a) throw new HttpError(404, 'This institute has no admin account.');
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  await q('update users set password_hash = $1, must_change_password = true, password_changed_at = $3 where id = $2',
    [await bcrypt.hash(temporaryPassword, 10), a.id, new Date()]);
  await switchTenant(req.params.id);
  await sendSetupLink(a);
  await switchTenant(null);
  await audit(req.user, 'tenant.admin_password_reset', 'tenant', req.params.id);
  res.json({ admin: { loginId: a.loginId, email: a.email, temporaryPassword } });
}

/** Lets the vendor confirm the proxy setting: `ip` should be the vendor's own public address (as shown by any "what is my IP" site). */
export async function networkDiagnostics(req, res) {
  res.json({
    ip: req.ip, forwardedFor: req.get('x-forwarded-for') || null, trustProxyHops: env.TRUST_PROXY_HOPS,
    protocol: req.protocol, secureCookiesExpected: env.COOKIE_SECURE,
    advice: 'If "ip" is not your own public address, change TRUST_PROXY_HOPS (try 2, then 3) and redeploy. If "protocol" is http while you use https, the proxy count is too low.',
  });
}

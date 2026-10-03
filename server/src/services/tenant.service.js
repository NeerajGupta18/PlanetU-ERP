import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q, switchTenant } from '../db/pool.js';
import { sendSetupLink } from './accounts.service.js';
import { HttpError } from '../middleware/error.js';
import { PRESETS, TENANT_TYPES, normaliseModules } from '../config/modules.js';
import { startSubscription } from './billing.service.js';

export const TENANT_CODE_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Creates a new client (tenant) with its institute profile and first admin.
 * Must run inside a PLATFORM-context transaction (Super Admin request or seeding).
 * The tenant's terminology and modules start from the preset for its type and
 * can be overridden. Returns the ids plus the admin's one-time password.
 */
export async function provisionTenant(input) {
  const {
    code, name, type, plan = 'trial', modules, terminology, settings = {}, shortName, admin = {}, trialDays,
  } = input;

  if (!TENANT_CODE_RE.test(code || '')) {
    throw new HttpError(400, 'Institute code must be 3-40 characters: lowercase letters, numbers and hyphens.');
  }
  if (!name || !String(name).trim()) throw new HttpError(400, 'Name is required.');
  if (!TENANT_TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${TENANT_TYPES.join(', ')}.`);
  if (!admin.name || !admin.email) throw new HttpError(400, 'The first admin needs a name and an email.');

  const preset = PRESETS[type];
  const finalModules = normaliseModules(modules ?? preset.modules);
  const finalTerms = { ...preset.terminology, ...(terminology || {}) };

  let tenantId;
  try {
    const { rows: [t] } = await q(
      `insert into tenants (code, name, type, plan, modules, terminology, settings)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [code, String(name).trim(), type, plan, finalModules, finalTerms, settings],
    );
    tenantId = t.id;
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, `The institute code "${code}" is already taken.`);
    throw err;
  }

  // Every real institute gets a subscription (demo institutes are never billed)
  await startSubscription(tenantId, plan, { trialDays });

  await switchTenant(tenantId);
  await q('insert into institute_profiles (name, short_name) values ($1, $2)', [
    String(name).trim(), shortName || String(name).trim().split(/\s+/)[0],
  ]);

  const password = admin.password || crypto.randomBytes(9).toString('base64url');
  const loginId = admin.loginId || 'ADM001';
  const { rows: [u] } = await q(
    `insert into users (role, login_id, email, name, password_hash, must_change_password)
     values ('admin', $1, $2, $3, $4, $5) returning id`,
    [loginId, admin.email, admin.name, await bcrypt.hash(password, 10), !admin.password],
  );
  // A generated password is temporary: the admin must replace it, and also gets an email link to do so
  if (!admin.password) await sendSetupLink({ id: u.id, name: admin.name, email: admin.email, loginId });

  await switchTenant(null); // hand the transaction back in platform-only context
  return { tenantId, admin: { loginId, email: admin.email, temporaryPassword: admin.password ? undefined : password } };
}

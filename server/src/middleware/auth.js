import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { beginTx, isUuid, q, runInTx } from '../db/pool.js';

/**
 * Commit-before-respond: the request's transaction is committed (or rolled back
 * for any 4xx/5xx) BEFORE the JSON body is sent, so a client that immediately
 * fires its next request always sees the previous write.
 */
function bindTxToResponse(res, tx) {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (tx.done) return send(body);
    (res.statusCode < 400 ? tx.commit() : tx.rollback())
      .then(() => send(body))
      .catch((err) => {
        console.error(err);
        res.status(500);
        send({ message: 'Something went wrong on our side.' });
      });
    return res;
  };
  // Client vanished mid-request: never leave a transaction (and its locks) open
  res.on('close', () => { if (!tx.done) tx.rollback().catch(() => {}); });
}

/** Paths an institute admin can still use while access is paused for non-payment. */
const BILLING_LOCK_ALLOWED = ['/api/admin/billing', '/api/auth/me', '/api/auth/logout', '/api/auth/change-password'];

const reject = (res, status, message) => {
  res.clearCookie(env.COOKIE_NAME);
  return res.status(status).json({ message });
};

/**
 * Verifies the session cookie, then opens ONE database transaction for the whole
 * request with the tenant taken from the signed token (never from the client).
 * Everything downstream - middleware and controllers - queries inside it, so
 * Row Level Security scopes every read and write to the user's own tenant.
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[env.COOKIE_NAME];
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });

  let claims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET);
    const platform = claims.role === 'super_admin';
    if (claims.typ !== 'session' || !isUuid(claims.sub) || (platform ? claims.tid : !isUuid(claims.tid))) {
      throw new Error('bad claims');
    }
  } catch {
    return reject(res, 401, 'Your session has expired. Please sign in again.');
  }

  const platform = claims.role === 'super_admin';
  let tx;
  try {
    tx = await beginTx({ tenantId: platform ? null : claims.tid, platform });
  } catch (err) {
    return next(err);
  }
  bindTxToResponse(res, tx);
  req.tx = tx;

  return runInTx(tx, async () => {
    try {
      const { rows: [u] } = await q(
        `select id, role, login_id as "loginId", email, name, tenant_id as "tenantId",
                student_id as "studentId", employee_id as "employeeId",
                must_change_password as "mustChangePassword", password_changed_at as "passwordChangedAt"
         from users where id = $1 and status = 'active'`,
        [claims.sub],
      );
      if (!u || u.role !== claims.role) return reject(res, 401, 'Your session has expired. Please sign in again.');
      // A password change ends every session that was issued before it
      const changedAt = new Date(u.passwordChangedAt).getTime();
      const mintedAt = claims.ims ?? claims.iat * 1000; // 'ims' = exact mint time (older tokens: whole seconds)
      if (mintedAt < changedAt) {
        return reject(res, 401, 'Your password was changed. Please sign in again.');
      }

      let tenant = null;
      if (!platform) {
        ({ rows: [tenant] } = await q(
          'select id, code, name, type, status, plan, modules, terminology, suspension_reason as "suspensionReason" from tenants where id = $1', [u.tenantId],
        ));
        if (!tenant) return reject(res, 401, 'Your session has expired. Please sign in again.');
        if (tenant.status !== 'active') {
          // Paused for an unpaid subscription: everyone is out, EXCEPT that the institute's admin may open the
          // Billing page (and sign out / change password), so they can pay and be restored on the spot.
          const billingLocked = tenant.suspensionReason === 'billing';
          if (!(billingLocked && u.role === 'admin' && BILLING_LOCK_ALLOWED.some((p) => req.originalUrl.split('?')[0].startsWith(p)))) {
            return res.status(403).json({
              code: billingLocked ? 'BILLING_LOCKED' : 'SUSPENDED',
              message: billingLocked
                ? (u.role === 'admin' ? 'Your institute\'s subscription is overdue, so access is paused. Open Billing to pay and restore it.' : "Your institute's access is temporarily paused. Please contact your institute's administrator.")
                : "This institute's account is suspended. Please contact PlanetU support.",
            });
          }
          tenant.billingLocked = true;
        }
      }
      req.user = { ...u, profileId: u.studentId || u.employeeId };
      // Accounts on a temporary password can do nothing except change it (or sign out / see who they are)
      if (u.mustChangePassword && req.baseUrl !== '/api/auth') {
        return res.status(403).json({ message: 'Please choose a new password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      req.tenant = tenant;
      return next();
    } catch (err) {
      return next(err);
    }
  });
}

/**
 * Put this AFTER a multipart parser (multer). requireAuth binds the request's database transaction to the
 * request's async context, but when an upload body arrives in several network chunks the parser calls back
 * from outside that context, and the next handler would fail with "Database access outside a tenant
 * context" (seen with uploads of a few hundred KB). This re-attaches the transaction before continuing.
 */
export const rebindTx = (req, res, next) => (req.tx ? runInTx(req.tx, next) : next());

/** Usage: router.use(requireRole('student')) */
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ message: 'You do not have access to this section.' });
  }
  return next();
};

/** Blocks a route when the institute's plan/config has the module switched off. */
export const requireModule = (key) => (req, res, next) => {
  if (!req.tenant?.modules?.includes(key)) {
    return res.status(403).json({ message: 'This module is not enabled for your institute.', code: 'MODULE_DISABLED' });
  }
  return next();
};

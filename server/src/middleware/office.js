import { isUuid } from '../db/pool.js';
import { HttpError } from './error.js';
import { ADMIN_ONLY, LOOKUPS, areaOfSegment } from '../config/staffRoles.js';
import { officeOf } from '../services/staff.service.js';

/**
 * Who may use the admin API. The institute admin may use all of it. An employee with staff roles may use the areas
 * their roles grant (and read the lookup lists); everything else answers 403. While a staff member is inside an
 * area they act with the office's powers there (req.user.role becomes 'admin', and req.user.staff says who they
 * really are, so the audit log records them as staff). A head of department only reads, plus decides leave, and
 * only for their own department (req.office.scope.departmentIds).
 */
export async function officeAccess(req, res, next) {
  try {
    if (req.user.role === 'admin') { req.office = { full: true, scope: null, reportGroups: null }; return next(); }
    if (req.user.role !== 'employee') throw new HttpError(403, 'You do not have access to this page.');
    const office = await officeOf(req.user);
    if (!office) throw new HttpError(403, 'You do not have access to this page.');

    const parts = req.path.split('/').filter(Boolean);
    const seg = parts[0] || '';
    const reading = req.method === 'GET' || req.method === 'HEAD';
    const deny = () => { throw new HttpError(403, 'Your staff role does not include this.'); };
    if (ADMIN_ONLY.includes(seg)) deny();

    const area = areaOfSegment(seg);
    const grant = area ? office.areas[area] : null;
    let scope = null;
    if (grant) {
      if (grant.scope === 'department') {
        // A head of department reads their department's records and decides its leave requests - nothing else
        const decidesLeave = area === 'leave' && req.method === 'PUT' && parts.length === 2 && isUuid(parts[1]);
        if (!reading && !decidesLeave) deny();
        if (area === 'leave' && reading && parts[1] && !['balances', 'on-leave', 'types'].includes(parts[1])) deny();
        scope = { departmentIds: grant.departmentIds };
      }
    } else if (seg === 'reports') {
      if (!office.reportGroups.length) deny();
    } else if (!(reading && LOOKUPS.includes(seg))) {
      deny();
    }

    req.office = { full: false, scope, reportGroups: office.reportGroups, roles: office.roles, areas: office.areas };
    req.user = { ...req.user, role: 'admin', staff: { roles: office.roles.map((r) => r.role) } };
    return next();
  } catch (err) {
    return next(err);
  }
}

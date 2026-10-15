import { HttpError } from '../middleware/error.js';
import { employeesIn } from '../services/staff.service.js';
import * as svc from '../services/leave.service.js';

const yearOf = (req) => { const y = Number(req.query.year); return Number.isInteger(y) && y > 2000 && y < 2200 ? y : undefined; };

/* ---------- employee ---------- */
export const mine = async (req, res) => res.json(await svc.listMine(req.user.employeeId, yearOf(req)));
export const apply = async (req, res) => res.status(201).json({ request: await svc.apply(req.user.employeeId, req.body || {}, req.user) });
export const cancel = async (req, res) => res.json({ request: await svc.cancel(req.user.employeeId, req.params.id, req.user) });

/* ---------- office ---------- */
// A head of department (req.office.scope) only sees and decides leave for their own department
const deptStaff = async (req) => (req.office?.scope ? employeesIn(req.office.scope.departmentIds) : null);
export const list = async (req, res) => {
  const out = await svc.listForAdmin({ status: req.query.status, search: req.query.search });
  const mine = await deptStaff(req);
  if (!mine) return res.json(out);
  const all = (await svc.listForAdmin({})).requests.filter((r) => mine.has(r.employeeId));
  return res.json({ ...out, requests: out.requests.filter((r) => mine.has(r.employeeId)), counts: all.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {}) });
};
export const decide = async (req, res) => {
  const mine = await deptStaff(req);
  if (mine && !mine.has(await svc.employeeOfRequest(req.params.id))) throw new HttpError(403, 'This request is not from your department.');
  res.json({ request: await svc.decide(req.params.id, req.body || {}, req.user) });
};
export const record = async (req, res) => res.status(201).json({ request: await svc.recordForEmployee(req.body || {}, req.user) });
export const balances = async (req, res) => {
  const out = await svc.balancesAll(yearOf(req));
  const mine = await deptStaff(req);
  res.json(mine ? { ...out, employees: (out.employees || []).filter((e) => mine.has(e.employeeId)) } : out);
};
export const onLeave = async (req, res) => {
  const mine = await deptStaff(req);
  res.json({ employees: (await svc.onLeave()).filter((e) => !mine || mine.has(e.employeeId)) });
};
export const types = async (req, res) => res.json({ types: await svc.listTypes() });
export const createType = async (req, res) => res.status(201).json({ type: await svc.createType(req.body || {}, req.user) });
export const updateType = async (req, res) => res.json({ type: await svc.updateType(req.params.id, req.body || {}, req.user) });
export const removeType = async (req, res) => { await svc.removeType(req.params.id, req.user); res.json({ success: true }); };
export const standardTypes = async (req, res) => res.json(await svc.addStandardTypes(req.user));

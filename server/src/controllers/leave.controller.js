import * as svc from '../services/leave.service.js';

const yearOf = (req) => { const y = Number(req.query.year); return Number.isInteger(y) && y > 2000 && y < 2200 ? y : undefined; };

/* ---------- employee ---------- */
export const mine = async (req, res) => res.json(await svc.listMine(req.user.employeeId, yearOf(req)));
export const apply = async (req, res) => res.status(201).json({ request: await svc.apply(req.user.employeeId, req.body || {}, req.user) });
export const cancel = async (req, res) => res.json({ request: await svc.cancel(req.user.employeeId, req.params.id, req.user) });

/* ---------- office ---------- */
export const list = async (req, res) => res.json(await svc.listForAdmin({ status: req.query.status, search: req.query.search }));
export const decide = async (req, res) => res.json({ request: await svc.decide(req.params.id, req.body || {}, req.user) });
export const record = async (req, res) => res.status(201).json({ request: await svc.recordForEmployee(req.body || {}, req.user) });
export const balances = async (req, res) => res.json(await svc.balancesAll(yearOf(req)));
export const onLeave = async (req, res) => res.json({ employees: await svc.onLeave() });
export const types = async (req, res) => res.json({ types: await svc.listTypes() });
export const createType = async (req, res) => res.status(201).json({ type: await svc.createType(req.body || {}, req.user) });
export const updateType = async (req, res) => res.json({ type: await svc.updateType(req.params.id, req.body || {}, req.user) });
export const removeType = async (req, res) => { await svc.removeType(req.params.id, req.user); res.json({ success: true }); };
export const standardTypes = async (req, res) => res.json(await svc.addStandardTypes(req.user));

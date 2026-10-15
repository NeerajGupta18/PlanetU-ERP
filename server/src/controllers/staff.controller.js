import * as svc from '../services/staff.service.js';

export const list = async (req, res) => res.json(await svc.list());
export const grant = async (req, res) => res.status(201).json(await svc.grant(req.user, req.body || {}));
export const revoke = async (req, res) => res.json(await svc.revoke(req.user, req.params.employeeId, req.params.role));

import * as svc from '../services/assets.service.js';

export const list = async (req, res) => res.json({ assets: await svc.listAssets({ search: req.query.search, status: req.query.status, category: req.query.category, departmentId: req.query.departmentId }) });
export const get = async (req, res) => res.json({ asset: await svc.getAsset(req.params.id) });
export const create = async (req, res) => res.status(201).json({ asset: await svc.createAsset(req.body, req.user) });
export const update = async (req, res) => res.json({ asset: await svc.updateAsset(req.params.id, req.body) });
export const remove = async (req, res) => { await svc.deleteAsset(req.params.id); res.json({ success: true }); };
export const assign = async (req, res) => res.json({ asset: await svc.assign(req.params.id, req.body?.employeeId, req.user) });
export const unassign = async (req, res) => res.json({ asset: await svc.unassign(req.params.id, req.user) });
export const setStatus = async (req, res) => res.json({ asset: await svc.setStatus(req.params.id, req.body?.status, req.body?.note, req.user) });
export const logMaintenance = async (req, res) => res.json({ asset: await svc.logMaintenance(req.params.id, req.body?.note, req.body?.cost, req.user) });

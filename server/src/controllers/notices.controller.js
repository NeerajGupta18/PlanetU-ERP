import * as svc from '../services/notices.service.js';

/* ---------- office ---------- */
export const list = async (req, res) => res.json(await svc.listForAdmin({ state: req.query.state, search: req.query.search }));
export const create = async (req, res) => res.status(201).json(await svc.create(req.body || {}, req.user));
export const update = async (req, res) => res.json(await svc.update(req.params.id, req.body || {}, req.user));
export const remove = async (req, res) => { await svc.remove(req.params.id, req.user); res.json({ success: true }); };

/* ---------- students and staff ---------- */
export const mine = async (req, res) => res.json(await svc.feed(req.user));
export const read = async (req, res) => { await svc.markRead(req.user, req.params.id); res.json({ success: true }); };
export const readAll = async (req, res) => { await svc.markAllRead(req.user); res.json({ success: true }); };

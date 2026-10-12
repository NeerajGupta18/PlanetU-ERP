import * as svc from '../services/visitors.service.js';

export const meta = async (req, res) => res.json({ purposes: svc.PURPOSES, idTypes: svc.ID_TYPES, hosts: await svc.hosts() });
export const summary = async (req, res) => res.json(await svc.summary());
export const list = async (req, res) => res.json({ visits: await svc.list(req.user, req.query) });
export const register = async (req, res) => res.status(201).json({ visit: await svc.register(req.user, req.body || {}) });
export const checkIn = async (req, res) => res.json({ visit: await svc.checkIn(req.user, req.params.id, req.body || {}) });
export const checkOut = async (req, res) => res.json({ visit: await svc.checkOut(req.user, req.params.id) });
export const cancel = async (req, res) => res.json({ visit: await svc.cancel(req.user, req.params.id) });

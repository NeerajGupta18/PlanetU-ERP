import * as svc from '../services/assignments.service.js';

/* ---------- teacher / office ---------- */
export const scope = async (req, res) => res.json(await svc.scope(req.user));
export const list = async (req, res) => res.json({ assignments: await svc.list(req.user, { courseId: req.query.courseId, status: req.query.status }) });
export const create = async (req, res) => res.status(201).json({ assignment: await svc.create(req.user, req.body || {}) });
export const get = async (req, res) => res.json(await svc.detail(req.user, req.params.id));
export const update = async (req, res) => res.json({ assignment: await svc.update(req.user, req.params.id, req.body || {}) });
export const remove = async (req, res) => { await svc.remove(req.user, req.params.id); res.json({ success: true }); };
export const publish = async (req, res) => res.json({ assignment: await svc.publish(req.user, req.params.id) });
export const close = async (req, res) => res.json({ assignment: await svc.close(req.user, req.params.id) });
export const reopen = async (req, res) => res.json({ assignment: await svc.reopen(req.user, req.params.id) });
export const grade = async (req, res) => res.json({ submission: await svc.grade(req.user, req.params.id, req.params.studentId, req.body || {}) });

/* ---------- student ---------- */
export const mine = async (req, res) => res.json(await svc.listMine(req.user.studentId));
export const mineOne = async (req, res) => res.json(await svc.getMine(req.user.studentId, req.params.id));
export const submit = async (req, res) => res.json(await svc.submit(req.user, req.params.id, req.body || {}));

import * as g from '../services/grievances.service.js';
import * as fb from '../services/feedback.service.js';

/* ---------- the person raising a ticket (student, parent, employee) ---------- */
export const mine = async (req, res) => res.json(await g.listMine(req.user));
export const create = async (req, res) => res.status(201).json({ grievance: await g.create(req.user, req.body || {}, { studentId: req.childId }) });
export const one = async (req, res) => res.json(await g.getMine(req.user, req.params.id));
export const reply = async (req, res) => res.json(await g.replyMine(req.user, req.params.id, req.body || {}));
export const close = async (req, res) => res.json(await g.closeMine(req.user, req.params.id));

/* ---------- the office ---------- */
export const list = async (req, res) => res.json(await g.listForAdmin({ status: req.query.status, category: req.query.category, search: req.query.search }));
export const adminOne = async (req, res) => res.json(await g.getForAdmin(req.params.id));
export const adminReply = async (req, res) => res.json(await g.replyAdmin(req.params.id, req.body || {}, req.user));

/* ---------- feedback ---------- */
export const forms = async (req, res) => res.json(await fb.listForms());
export const form = async (req, res) => res.json(await fb.getForm(req.params.id));
export const createForm = async (req, res) => res.status(201).json(await fb.createForm(req.body || {}, req.user));
export const updateForm = async (req, res) => res.json(await fb.updateForm(req.params.id, req.body || {}, req.user));
export const formStatus = async (req, res) => res.json(await fb.setStatus(req.params.id, (req.body || {}).status, req.user));
export const removeForm = async (req, res) => { await fb.removeForm(req.params.id, req.user); res.json({ success: true }); };
export const results = async (req, res) => res.json(await fb.results(req.params.id));
export const myForms = async (req, res) => res.json(await fb.listForUser(req.user));
export const myForm = async (req, res) => res.json(await fb.formForUser(req.user, req.params.id));
export const submitForm = async (req, res) => res.status(201).json(await fb.submit(req.user, req.params.id, req.body || {}));

import * as svc from '../services/placement.service.js';

/* ---------- office ---------- */
export const stats = async (req, res) => res.json(await svc.stats());
export const companies = async (req, res) => res.json({ companies: await svc.listCompanies() });
export const createCompany = async (req, res) => res.status(201).json({ company: await svc.createCompany(req.body || {}, req.user) });
export const updateCompany = async (req, res) => res.json({ company: await svc.updateCompany(req.params.id, req.body || {}, req.user) });
export const removeCompany = async (req, res) => { await svc.removeCompany(req.params.id, req.user); res.json({ success: true }); };
export const drives = async (req, res) => res.json({ drives: await svc.listDrives({ status: req.query.status }) });
export const createDrive = async (req, res) => res.status(201).json({ drive: await svc.createDrive(req.body || {}, req.user) });
export const drive = async (req, res) => res.json(await svc.driveDetail(req.params.id));
export const updateDrive = async (req, res) => res.json({ drive: await svc.updateDrive(req.params.id, req.body || {}, req.user) });
export const removeDrive = async (req, res) => { await svc.removeDrive(req.params.id, req.user); res.json({ success: true }); };
export const openDrive = async (req, res) => res.json({ drive: await svc.openDrive(req.params.id, req.user) });
export const closeDrive = async (req, res) => res.json({ drive: await svc.closeDrive(req.params.id, req.user) });
export const decide = async (req, res) => res.json({ application: await svc.decide(req.params.id, req.body || {}, req.user) });

/* ---------- student ---------- */
export const mine = async (req, res) => res.json(await svc.drivesForStudent(req.user.studentId));
export const apply = async (req, res) => res.json(await svc.apply(req.user, req.params.id, req.body || {}));
export const withdraw = async (req, res) => res.json(await svc.withdraw(req.user, req.params.id));

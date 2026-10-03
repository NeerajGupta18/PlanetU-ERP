import * as svc from '../services/admissions.service.js';

export const list = async (req, res) => res.json(await svc.listApplications({ status: req.query.status, search: req.query.search }));
export const get = async (req, res) => res.json({ application: await svc.getApplication(req.params.id) });
export const review = async (req, res) => res.json({ application: await svc.reviewDocument(req.params.id, req.params.docId, req.body || {}, req.user) });
export const decide = async (req, res) => res.json({ application: await svc.decide(req.params.id, req.body || {}, req.user) });
export const enroll = async (req, res) => res.json(await svc.enroll(req.params.id, req.user));

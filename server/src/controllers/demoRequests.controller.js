import * as svc from '../services/demoRequests.service.js';

export const list = async (req, res) => res.json(await svc.listDemoRequests());
export const setStatus = async (req, res) => res.json(await svc.setDemoRequestStatus(req.params.id, req.body?.status));

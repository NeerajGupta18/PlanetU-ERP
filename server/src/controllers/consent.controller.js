import * as svc from '../services/consent.service.js';

export const status = async (req, res) => res.json(await svc.consentStatus(req.user.id));
export const record = async (req, res) => res.status(201).json(
  await svc.recordConsent(req.user, req.body?.answers, { ip: req.ip, userAgent: req.get('user-agent') }),
);

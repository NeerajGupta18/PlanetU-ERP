/**
 * Public (no account) admissions endpoints. The institute comes from the URL code; the applicant
 * proves ownership of THEIR application with the secret access code returned at creation.
 * Everything still runs inside a tenant-scoped transaction, so RLS applies here too.
 */
import { HttpError } from '../middleware/error.js';
import { consumeCaptchaToken } from '../services/captcha.service.js';
import { instituteBrief } from '../db/repo.js';
import * as svc from '../services/admissions.service.js';

const code = (req) => req.headers['x-access-code'];

export const info = async (req, res) => res.json({
  institute: await instituteBrief(),
  terminology: req.publicTenant.terminology,
  ...(await svc.admissionsInfo()),
});

export async function create(req, res) {
  if (!consumeCaptchaToken(req.body?.captchaToken)) {
    throw new HttpError(400, 'Tick "I\'m not a robot" before submitting.');
  }
  res.status(201).json(await svc.createApplication(req.body));
}

export const status = async (req, res) => res.json({ application: await svc.applicantView(await svc.loadForApplicant(req.params.id, code(req))) });

export async function upload(req, res) {
  const app = await svc.loadForApplicant(req.params.id, code(req));
  res.status(201).json({ application: await svc.attachDocument(app, req.body?.docType, req.file) });
}

export async function submit(req, res) {
  const app = await svc.loadForApplicant(req.params.id, code(req));
  res.json({ application: await svc.submitApplication(app) });
}

export const lookup = async (req, res) => res.json({
  application: await svc.applicantView(await svc.loadByNumber(req.body?.applicationNo, req.body?.accessCode)),
});

export async function recover(req, res) {
  if (!consumeCaptchaToken(req.body?.captchaToken)) throw new HttpError(400, 'Tick "I\'m not a robot" first.');
  await svc.recoverAccess(req.body?.email);
  res.json({ message: 'If an application exists for that email, we have sent new access details to it.' });
}

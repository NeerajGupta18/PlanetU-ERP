import { getInstitute } from '../db/repo.js';
import * as svc from '../services/certificates.service.js';
import { streamCertificate } from '../services/certificate.pdf.js';

/* ---------- student ---------- */
export const mine = async (req, res) => res.json(await svc.listMine(req.user));
export const request = async (req, res) => res.status(201).json({ request: await svc.request(req.user, req.body) });
export async function myPdf(req, res) {
  const cert = await svc.forPdf(req.params.id, { forStudentId: req.user.studentId });
  const institute = await getInstitute();
  await req.tx.commit();
  return streamCertificate(res, { institute, cert });
}

/* ---------- office ---------- */
export const list = async (req, res) => res.json(await svc.listForAdmin({ status: req.query.status, search: req.query.search }));
export const decide = async (req, res) => res.json({ request: await svc.decide(req.params.id, req.body, req.user, req.tenant.modules) });
export const issue = async (req, res) => res.status(201).json({ request: await svc.issueDirect(req.body, req.user, req.tenant.modules) });
export async function pdf(req, res) {
  const cert = await svc.forPdf(req.params.id);
  const institute = await getInstitute();
  await req.tx.commit();
  return streamCertificate(res, { institute, cert });
}

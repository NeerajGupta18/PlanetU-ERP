import { HttpError } from '../middleware/error.js';
import { getInstitute } from '../db/repo.js';
import * as svc from '../services/fees.service.js';
import { streamReceipt } from '../services/receipt.service.js';

export const listStructures = async (req, res) => res.json({ structures: await svc.listStructures() });
export const createStructure = async (req, res) => res.status(201).json({ structure: await svc.createStructure(req.body) });
export const deleteStructure = async (req, res) => { await svc.deleteStructure(req.params.id); res.json({ success: true }); };
export const assignStructure = async (req, res) => {
  const n = await svc.assignStructure(req.params.id, req.body?.studentId, req.user);
  res.status(201).json({ itemsCreated: n });
};
export const bulkAssign = async (req, res) => res.status(201).json({ studentsAssigned: await svc.bulkAssign(req.params.id, req.user) });

export const studentFees = async (req, res) => res.json(await svc.studentFees(req.params.id));
export const addManualItem = async (req, res) => { await svc.addManualItem(req.params.id, req.body, req.user); res.status(201).json(await svc.studentFees(req.params.id)); };
export const waiveItem = async (req, res) => { const sid = await svc.waiveItem(req.params.itemId, req.body?.reason, req.user); res.json(await svc.studentFees(sid)); };

export const listPayments = async (req, res) => res.json({ payments: await svc.listPayments({ studentId: req.query.studentId, search: req.query.search }) });
export const recordPayment = async (req, res) => res.status(201).json({ payment: await svc.recordPayment(req.body, req.user) });

async function issueReceipt(res, paymentId, req) {
  const payment = await svc.getPayment(paymentId);
  const institute = await getInstitute();
  await req.tx.commit();
  await streamReceipt(res, { institute, payment, student: { name: payment.studentName, studentCode: payment.studentCode, course: null } });
}
export const receipt = (req, res) => issueReceipt(res, req.params.id, req);

/** Own-record variant for the student portal. */
export async function myFees(req, res) { res.json(await svc.studentFees(req.user.studentId)); }
export async function myReceipt(req, res) {
  const payment = await svc.getPayment(req.params.id);
  if (payment.studentId !== req.user.studentId) throw new HttpError(404, 'Receipt not found.');
  const institute = await getInstitute();
  await req.tx.commit();
  await streamReceipt(res, { institute, payment, student: { name: payment.studentName, studentCode: payment.studentCode, course: null } });
}

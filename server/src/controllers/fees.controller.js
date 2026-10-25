import { HttpError } from '../middleware/error.js';
import { getInstitute } from '../db/repo.js';
import * as svc from '../services/fees.service.js';
import { streamReceipt } from '../services/receipt.service.js';
import { loadBrand } from '../services/pdfBrand.js';
import { streamTablePdf } from '../services/tablepdf.js';

export const classDues = async (req, res) => res.json(await svc.classDues(req.query.courseId));
export const summary = async (req, res) => res.json(await svc.summary());
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

/** Loads everything the receipt needs (with the institute's logo and colour) inside the transaction, then streams it. */
async function sendReceipt(res, payment, req) {
  const institute = await getInstitute();
  const brand = await loadBrand(institute);
  await req.tx.commit();
  await streamReceipt(res, { institute, brand, payment, student: { name: payment.studentName, studentCode: payment.studentCode, course: payment.course } });
}
export const receipt = async (req, res) => sendReceipt(res, await svc.getPayment(req.params.id), req);

export const concession = async (req, res) => res.json(await svc.studentFees(await svc.giveConcession(req.params.itemId, req.body, req.user)));
export const lateFees = async (req, res) => res.json(await svc.applyLateFees(req.body, req.user));
export const reminders = async (req, res) => res.json(await svc.reminders({ courseId: req.query.courseId || undefined, overdueOnly: req.query.overdue === '1' }));
export const sendReminders = async (req, res) => res.json(await svc.sendReminders(req.body, req.user));

/** GET /fees/day-end?date=YYYY-MM-DD[&format=pdf] - the day's collection, to close the cash drawer against. */
export async function dayEnd(req, res) {
  const d = await svc.dayEnd(req.query.date || undefined);
  if (req.query.format !== 'pdf') return res.json(d);
  const institute = await getInstitute();
  await req.tx.commit();
  const money = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return streamTablePdf(res, {
    institute, title: 'Day-end fee summary', filters: [['Date', d.date]],
    summary: [['Collected', `Rs. ${money(d.total)}`], ['Receipts', String(d.count)], ...d.byMethod.map((m) => [m.label, `Rs. ${money(m.amount)}`])],
    columns: [
      { header: 'Receipt', key: 'receiptNo' }, { header: 'Student', key: 'studentName' }, { header: 'ID', key: 'studentCode' },
      { header: 'Method', key: 'methodLabel' }, { header: 'Taken by', key: 'receivedBy' }, { header: 'Amount', key: 'amount', type: 'money' },
    ],
    rows: d.receipts, generatedBy: req.user.name, filename: `day-end-${d.date}.pdf`,
  });
}

/** Own-record variant for the student portal. */
export async function myFees(req, res) { res.json(await svc.studentFees(req.user.studentId)); }
export async function myReceipt(req, res) {
  const payment = await svc.getPayment(req.params.id);
  if (payment.studentId !== req.user.studentId) throw new HttpError(404, 'Receipt not found.');
  await sendReceipt(res, payment, req);
}

import { getInstitute } from '../db/repo.js';
import * as svc from '../services/payroll.service.js';
import { streamPayslip } from '../services/payslip.pdf.js';

/* ---------- employee ---------- */
export const mine = async (req, res) => res.json(await svc.myPayslips(req.user.employeeId));
export async function myPdf(req, res) {
  const slip = await svc.slipForPdf(req.params.id, { employeeId: req.user.employeeId });
  const institute = await getInstitute();
  await req.tx.commit();
  return streamPayslip(res, { institute, slip });
}

/* ---------- office ---------- */
export const salaries = async (req, res) => res.json({ employees: await svc.listSalaries({ search: req.query.search }) });
export const setSalary = async (req, res) => res.json({ salary: await svc.setSalary(req.params.id, req.body || {}, req.user) });
export const removeSalary = async (req, res) => { await svc.removeSalary(req.params.id, req.user); res.json({ success: true }); };
export const runs = async (req, res) => res.json({ runs: await svc.listRuns() });
export const createRun = async (req, res) => res.status(201).json(await svc.createRun(req.body || {}, req.user));
export const getRun = async (req, res) => res.json(await svc.getRun(req.params.id));
export const finalise = async (req, res) => res.json(await svc.finalise(req.params.id, req.user));
export const removeRun = async (req, res) => { await svc.removeRun(req.params.id, req.user); res.json({ success: true }); };
export async function pdf(req, res) {
  const slip = await svc.slipForPdf(req.params.id);
  const institute = await getInstitute();
  await req.tx.commit();
  return streamPayslip(res, { institute, slip });
}

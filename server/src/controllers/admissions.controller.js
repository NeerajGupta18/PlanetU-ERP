import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { getInstitute } from '../db/repo.js';
import { csvCell } from '../utils/csv.js';
import { streamTablePdf } from '../services/tablepdf.js';
import * as svc from '../services/admissions.service.js';

export const list = async (req, res) => res.json(await svc.listApplications({
  status: req.query.status, search: req.query.search, courseId: req.query.courseId, fee: req.query.fee,
}));
export const get = async (req, res) => res.json({ application: await svc.getApplication(req.params.id) });
export const review = async (req, res) => res.json({ application: await svc.reviewDocument(req.params.id, req.params.docId, req.body || {}, req.user) });
export const decide = async (req, res) => res.json({ application: await svc.decide(req.params.id, req.body || {}, req.user) });
export const enroll = async (req, res) => res.json(await svc.enroll(req.params.id, req.user));

export const getSettings = async (req, res) => res.json({ settings: await svc.getSettings() });
export const updateSettings = async (req, res) => res.json({ settings: await svc.updateSettings(req.body, req.user) });
export const walkIn = async (req, res) => res.status(201).json(await svc.createWalkIn(req.body, req.user));
export const uploadDocument = async (req, res) => res.status(201).json({ application: await svc.adminAttachDocument(req.params.id, req.body?.docType, req.file, req.user) });
export const bulkDecide = async (req, res) => res.json(await svc.bulkDecide(req.body, req.user));
export const setFee = async (req, res) => res.json({ application: await svc.setFee(req.params.id, req.body, req.user) });
export const setMerit = async (req, res) => res.json({ application: await svc.setMerit(req.params.id, req.body?.meritScore, req.user) });

const COLUMNS = [
  { header: 'Rank', key: 'rank', type: 'int' }, { header: 'Application no.', key: 'applicationNo' }, { header: 'Name', key: 'name' },
  { header: 'Course', key: 'course' }, { header: 'Merit', key: 'merit', type: 'number' }, { header: 'Category', key: 'category' },
  { header: 'Entrance', key: 'entrance' }, { header: 'Status', key: 'status' }, { header: 'Phone', key: 'phone' },
];

/** GET /admissions/merit-list?courseId=&format=json|csv|pdf */
export async function meritList(req, res) {
  const format = String(req.query.format || 'json').toLowerCase();
  if (!['json', 'csv', 'pdf'].includes(format)) throw new HttpError(400, 'Format must be json, csv or pdf.');
  const rows = await svc.meritList({ courseId: req.query.courseId });
  if (format === 'json') return res.json({ rows });
  await audit(req.user, 'admission.merit_export', 'application', null, { format, rows: rows.length });
  const institute = await getInstitute();
  await req.tx.commit();
  if (format === 'csv') {
    const lines = [COLUMNS.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c.key])).join(','))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="merit-list.csv"' });
    return res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
  }
  return streamTablePdf(res, {
    institute, title: 'Merit list', subtitle: 'Ranked by qualifying percentage (or the merit score set by the office)',
    columns: COLUMNS.filter((c) => !['phone'].includes(c.key)), rows, generatedBy: req.user.name, filename: 'merit-list.pdf',
  });
}

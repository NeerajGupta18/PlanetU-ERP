import { HttpError } from '../middleware/error.js';
import * as setup from '../services/setup.service.js';
import * as staffImport from '../services/staffImport.service.js';

const modulesOf = (req) => req.tenant?.modules || [];

/* ---------- the setup wizard ---------- */
export const wizard = async (req, res) => res.json(await setup.wizard(modulesOf(req)));
export const saveBrand = async (req, res) => res.json(await setup.saveBrand(req.user, req.body || {}));
export const saveLogo = async (req, res) => res.json(await setup.saveLogo(req.user, req.file?.buffer));
export const removeLogo = async (req, res) => res.json(await setup.removeLogo(req.user));
export const saveYear = async (req, res) => res.json(await setup.saveYear(req.user, req.body || {}));
export const saveDivisions = async (req, res) => res.json(await setup.saveDivisions(req.user, req.params.id, req.body || {}));
export const addSubject = async (req, res) => res.status(201).json(await setup.addSubject(req.user, req.body || {}));
export const removeSubject = async (req, res) => res.json(await setup.removeSubject(req.user, req.params.subjectId));
export const addTeacher = async (req, res) => res.status(201).json(await setup.addTeacher(req.user, req.body || {}));
export const invite = async (req, res) => res.json(await setup.invitePeople(req.user, modulesOf(req)));
export const sampleData = async (req, res) => res.json(await setup.setSampleData(req.user, Boolean(req.body?.on)));

/* ---------- staff import (CSV), checked before anything is written ---------- */
const fileOf = (req) => {
  if (!req.file) throw new HttpError(400, 'Choose a CSV file to upload.');
  return req.file;
};

export async function staffTemplate(req, res) {
  await req.tx.commit();
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="staff-import-template.csv"' });
  res.send(staffImport.templateCsv());
}

export async function staffPreview(req, res) {
  const a = await staffImport.analyse(fileOf(req).buffer);
  res.json({ summary: a.summary, unknownColumns: a.unknownColumns, notes: a.notes, rows: a.rows.map(staffImport.previewRow) });
}

export async function staffCommit(req, res) {
  const file = fileOf(req);
  const skipInvalid = String(req.body?.skipInvalid ?? 'false').toLowerCase() === 'true';
  res.status(201).json(await staffImport.importStaff(file.buffer, { skipInvalid, fileName: file.originalname }, req.user));
}

/* ---------- the institute's logo, for every signed-in member of the institute ---------- */
export async function logo(req, res) {
  const l = await setup.logoOf();
  await req.tx.commit();
  if (!l) return res.status(404).json({ message: 'This institute has no logo yet. The admin can add one in Setup.' });
  res.set({ 'Content-Type': l.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  return res.send(l.bytes);
}

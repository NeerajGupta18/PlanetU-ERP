import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { getInstitute } from '../db/repo.js';
import * as svc from '../services/students.service.js';
import { streamIdCard } from '../services/idcard.service.js';
import * as importer from '../services/studentImport.service.js';

export const list = async (req, res) => res.json({ students: await svc.listStudents({ course: req.query.courseId, status: req.query.status, search: req.query.search }) });
export const get = async (req, res) => res.json({ student: await svc.getStudent(req.params.id) });
export const update = async (req, res) => res.json({ student: await svc.updateStudent(req.params.id, req.body || {}, req.user) });
export const setPhoto = async (req, res) => res.json({ student: await svc.setPhoto(req.params.id, req.body?.fileId ?? null) });

/** Shared by the admin route (any student) and the student route (their own record only). */
export async function issueIdCard(res, tenant, studentId, req) {
  if (!tenant?.modules?.includes('id_cards')) throw new HttpError(403, 'ID cards are not enabled for your institute.');
  const student = await svc.getStudent(studentId);
  const institute = await getInstitute();
  let photoStorageKey = null;
  if (student.photoFileId) {
    const { rows: [f] } = await q('select storage_key from files where id = $1', [student.photoFileId]);
    photoStorageKey = f?.storage_key ?? null;
  }
  await req.tx.commit(); // release the database transaction before streaming the PDF
  await streamIdCard(res, { institute, student, term: tenant.terminology, photoStorageKey });
}

export const idCard = (req, res) => issueIdCard(res, req.tenant, req.params.id, req);

/* ---------- bulk import (CSV) ---------- */
// Multipart text fields arrive as strings: anything but the literal "false" keeps the default of true
const flag = (v, fallback = true) => (v === undefined ? fallback : String(v).toLowerCase() !== 'false');
const fileOf = (req) => {
  if (!req.file) throw new HttpError(400, 'Choose a CSV file to upload.');
  return req.file;
};

export async function importTemplate(req, res) {
  const csv = await importer.templateCsv();
  await req.tx.commit();
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student-import-template.csv"' });
  res.send(csv);
}

export async function importPreview(req, res) {
  const a = await importer.analyse(fileOf(req).buffer, { createLogins: flag(req.body?.createLogins) });
  res.json({
    summary: a.summary, columns: a.columns, unknownColumns: a.unknownColumns, notes: a.notes,
    limits: importer.IMPORT_LIMITS, rows: a.rows.map(importer.previewRow),
  });
}

export async function importCommit(req, res) {
  const file = fileOf(req);
  const result = await importer.importStudents(file.buffer, {
    createLogins: flag(req.body?.createLogins), sendEmails: flag(req.body?.sendEmails), skipInvalid: flag(req.body?.skipInvalid, false),
    fileName: file.originalname,
  }, req.user);
  res.status(201).json(result);
}

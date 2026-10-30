import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { getInstitute } from '../db/repo.js';
import * as svc from '../services/students.service.js';
import { streamIdCard } from '../services/idcard.service.js';
import { loadBrand } from '../services/pdfBrand.js';
import * as importer from '../services/studentImport.service.js';
import { studentOverview } from '../services/attendance.service.js';
import { studentFees } from '../services/fees.service.js';
import { studentResults } from '../services/exams.service.js';

/**
 * The student list is a lookup every office desk may read to fill its pickers. Only the student office sees the whole
 * record: for anyone else it stops at who the student is and which class they are in.
 */
const deskOnly = (req) => Boolean(req.office && !req.office.full && req.office.areas?.students?.scope !== 'all');
const PICKER_FIELDS = ['id', 'studentCode', 'rollNo', 'name', 'courseId', 'course', 'semester', 'section', 'batch', 'status'];
const forDesk = (req, s) => (deskOnly(req) ? Object.fromEntries(PICKER_FIELDS.map((k) => [k, s[k]])) : s);

export const list = async (req, res) => res.json({ students: (await svc.listStudents({ course: req.query.courseId, status: req.query.status, search: req.query.search })).map((s) => forDesk(req, s)) });
export const get = async (req, res) => res.json({ student: forDesk(req, await svc.getStudent(req.params.id)) });
export const update = async (req, res) => res.json({ student: await svc.updateStudent(req.params.id, req.body || {}, req.user) });
/**
 * One student's record at a glance for the office: attendance, fees and published results, so whoever answers a
 * parent's call does not have to open three pages. Each part is null when its module is off.
 */
export async function overview(req, res) {
  // This summary (fees, marks) is for the student office only
  if (deskOnly(req)) throw new HttpError(403, 'Your staff role does not include this.');
  const has = (m) => req.tenant.modules.includes(m);
  const { rows: [st] } = await q('select id, attendance from students where id = $1', [req.params.id]);
  if (!st) throw new HttpError(404, 'Student not found.');
  const out = { attendance: null, fees: null, results: null };
  if (has('attendance')) {
    const o = await studentOverview(st.id, st.attendance || []);
    out.attendance = { overall: o.overall, attended: o.attended, total: o.total, threshold: o.threshold, low: o.subjects.filter((x) => x.pct < o.threshold).map((x) => ({ subject: x.subject, pct: x.pct })) };
  }
  if (has('fees')) {
    const f = await studentFees(st.id);
    const today = new Date().toISOString().slice(0, 10);
    const open = f.items.filter((i) => ['unpaid', 'partial'].includes(i.status));
    const overdue = open.filter((i) => i.dueDate && String(i.dueDate).slice(0, 10) < today).reduce((a, i) => a + Number(i.amount) - Number(i.paid), 0);
    out.fees = { ...f.summary, overdue: Math.round(overdue * 100) / 100 };
  }
  if (has('exams')) {
    const r = await studentResults(st.id);
    out.results = { cgpa: r.cgpa, exams: r.exams.slice(0, 5).map((e) => ({ id: e.id, name: e.name, semester: e.semester, gpa: e.gpa, pct: e.pct, result: e.result })) };
  }
  res.json(out);
}
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
  const brand = await loadBrand(institute);
  await req.tx.commit(); // release the database transaction before streaming the PDF
  await streamIdCard(res, { institute, student, term: tenant.terminology, photoStorageKey, brand });
}

export const idCard = (req, res) => {
  if (deskOnly(req)) throw new HttpError(403, 'Your staff role does not include this.');
  return issueIdCard(res, req.tenant, req.params.id, req);
};

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

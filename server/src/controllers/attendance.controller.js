import { isUuid, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { isISO } from '../utils/dates.js';
import * as svc from '../services/attendance.service.js';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const dateOr = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  if (!isISO(v)) throw new HttpError(400, 'Dates must look like YYYY-MM-DD.');
  return v;
};
const needSlot = (v) => {
  if (!isUuid(v)) throw new HttpError(400, 'Choose a lecture.');
  return v;
};

/* ---------- faculty (employee) ---------- */
export async function myLectures(req, res) {
  res.json(await svc.lecturesForEmployee(req.user.employeeId, svc.today()));
}

/* ---------- marking sheet: employee for their own lecture today, admin for any past/present date ---------- */
export async function getSheet(req, res) {
  const date = dateOr(req.query.date, svc.today());
  res.json(await svc.getSheet({ slotId: needSlot(req.query.slotId), date, actor: req.user }));
}

export async function saveSheet(req, res) {
  const { slotId, date, marks, submit } = req.body || {};
  res.json(await svc.saveSheet({
    slotId: needSlot(slotId), date: dateOr(date, svc.today()), marks, submit: submit === true, actor: req.user,
  }));
}

/* ---------- admin ---------- */
export async function daySheet(req, res) {
  const courseId = str(req.query.courseId);
  if (courseId && !isUuid(courseId)) throw new HttpError(400, 'Invalid course.');
  res.json(await svc.daySheet(dateOr(req.query.date, svc.today()), courseId));
}

function reportFilters(req) {
  const courseId = str(req.query.courseId);
  if (courseId && !isUuid(courseId)) throw new HttpError(400, 'Invalid course.');
  const from = dateOr(req.query.from, undefined);
  const to = dateOr(req.query.to, undefined);
  if (from && to && to < from) throw new HttpError(400, 'The end date cannot be before the start date.');
  const below = str(req.query.below);
  if (below !== undefined && !(Number(below) >= 0 && Number(below) <= 100)) throw new HttpError(400, 'Below must be a percentage from 0 to 100.');
  return { courseId, subject: str(req.query.subject), from, to, below };
}

export async function report(req, res) {
  res.json(await svc.report(reportFilters(req)));
}

export async function reportCsv(req, res) {
  const csv = await svc.reportCsv(reportFilters(req));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="attendance-report.csv"' });
  res.send(`\uFEFF${csv}`);
}

/* ---------- student ---------- */
export async function myAttendance(req, res) {
  const { rows: [s] } = await q('select attendance from students where id = $1', [req.user.studentId]);
  const overview = await svc.studentOverview(req.user.studentId, s?.attendance || []);
  res.json({ ...overview, recent: await svc.studentRecent(req.user.studentId) });
}

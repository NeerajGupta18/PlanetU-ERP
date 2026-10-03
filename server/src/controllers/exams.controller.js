import { HttpError } from '../middleware/error.js';
import { getInstitute } from '../db/repo.js';
import * as svc from '../services/exams.service.js';
import { streamReportCards } from '../services/reportcard.service.js';

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'exam';

/* ---------- admin: grading scale ---------- */
export const getGrading = async (req, res) => res.json(await svc.getGrading());
export const setGrading = async (req, res) => res.json(await svc.setGrading(req.body, req.user));
export const resetGrading = async (req, res) => res.json(await svc.resetGrading(req.user));

/* ---------- admin: exams & papers ---------- */
export const listExams = async (req, res) => {
  const { courseId, status } = req.query;
  if (status && !['draft', 'published'].includes(status)) throw new HttpError(400, 'Status must be draft or published.');
  res.json({ exams: await svc.listExams({ courseId: typeof courseId === 'string' && courseId ? courseId : undefined, status: status || undefined }) });
};
export const createExam = async (req, res) => res.status(201).json(await svc.createExam(req.body, req.user));
export const getExam = async (req, res) => res.json(await svc.getExam(req.params.id));
export const updateExam = async (req, res) => res.json(await svc.updateExam(req.params.id, req.body, req.user));
export const deleteExam = async (req, res) => { await svc.deleteExam(req.params.id, req.user); res.json({ success: true }); };
export const addPaper = async (req, res) => res.status(201).json(await svc.addPaper(req.params.id, req.body, req.user));
export const updatePaper = async (req, res) => res.json(await svc.updatePaper(req.params.id, req.params.paperId, req.body, req.user));
export const deletePaper = async (req, res) => res.json(await svc.deletePaper(req.params.id, req.params.paperId, req.user));
export const publish = async (req, res) => res.json(await svc.publishExam(req.params.id, req.user));
export const unpublish = async (req, res) => res.json(await svc.unpublishExam(req.params.id, req.user));

/* ---------- marks entry: admin (any paper) and employee (own papers) ---------- */
export const getMarks = async (req, res) => res.json(await svc.getMarkSheet({
  paperId: req.params.paperId, examId: req.params.id, actor: req.user,
}));
export const saveMarks = async (req, res) => res.json(await svc.saveMarkSheet({
  paperId: req.params.paperId, examId: req.params.id, entries: req.body?.entries, submit: req.body?.submit === true, actor: req.user,
}));
export const myPapers = async (req, res) => res.json({ papers: await svc.employeePapers(req.user.employeeId) });

/* ---------- admin: results, CSV, report cards ---------- */
export const results = async (req, res) => res.json(await svc.examResults(req.params.id));
export async function resultsCsv(req, res) {
  const csv = await svc.resultsCsv(req.params.id);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="exam-results.csv"' });
  res.send(`\uFEFF${csv}`);
}

// PDFs stream outside res.json(), so the request's transaction is committed by hand before piping
export async function reportCard(req, res) {
  const card = await svc.reportCardData(req.params.id, req.params.studentId, { publishedOnly: false });
  const institute = await getInstitute();
  await req.tx.commit();
  streamReportCards(res, { institute, cards: [card], filename: `report-card-${safe(card.student.code)}-${safe(card.exam.name)}.pdf` });
}
export async function reportCards(req, res) {
  const cards = await svc.allReportCards(req.params.id);
  const institute = await getInstitute();
  await req.tx.commit();
  streamReportCards(res, { institute, cards, filename: `report-cards-${safe(cards[0].exam.name)}.pdf` });
}

/* ---------- student ---------- */
export const myResults = async (req, res) => res.json(await svc.studentResults(req.user.studentId));
export async function myReportCard(req, res) {
  const card = await svc.reportCardData(req.params.id, req.user.studentId, { publishedOnly: true });
  const institute = await getInstitute();
  await req.tx.commit();
  streamReportCards(res, { institute, cards: [card], filename: `report-card-${safe(card.exam.name)}.pdf` });
}

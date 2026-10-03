import { HttpError } from '../middleware/error.js';
import * as svc from '../services/learning.service.js';

const sem = (v) => (v === undefined || v === '' ? undefined : v);

/* ---- admin + faculty (the service decides what each may see and do) ---- */
export const subjects = async (req, res) => res.json({ ...(await svc.scope(req.user)), providers: svc.PROVIDERS });
export const courses = async (req, res) => res.json({ courses: await svc.listCourses(req.user, { status: req.query.status }) });
export const course = async (req, res) => res.json({ course: await svc.getCourse(req.user, req.params.id) });
export const createCourse = async (req, res) => res.status(201).json({ course: await svc.saveCourse(req.user, null, req.body) });
export const updateCourse = async (req, res) => res.json({ course: await svc.saveCourse(req.user, req.params.id, req.body) });
export const deleteCourse = async (req, res) => { await svc.deleteCourse(req.user, req.params.id); res.json({ success: true }); };

export const assignments = async (req, res) => res.json({ assignments: await svc.listAssignments(req.user) });
export const createAssignment = async (req, res) => res.status(201).json(await svc.createAssignment(req.user, req.body));
export const assignment = async (req, res) => res.json(await svc.getAssignment(req.user, req.params.id));
export const updateAssignment = async (req, res) => res.json(await svc.updateAssignment(req.user, req.params.id, req.body));
export const deleteAssignment = async (req, res) => { await svc.deleteAssignment(req.user, req.params.id); res.json({ success: true }); };
export const syncAssignment = async (req, res) => res.json(await svc.syncAssignment(req.user, req.params.id));
export const reviewQueue = async (req, res) => res.json({ queue: await svc.reviewQueue(req.user) });
export const review = async (req, res) => res.json(await svc.reviewEnrollment(req.user, req.params.enrollmentId, req.body));
export const compliance = async (req, res) => {
  const { courseId, semester, subject } = req.query;
  res.json({ students: await svc.compliance(req.user, { courseId: sem(courseId), semester: sem(semester), subject: sem(subject) }) });
};

/* ---- student ---- */
const me = (req) => {
  if (!req.user.studentId) throw new HttpError(403, 'Students only.');
  return req.user.studentId;
};
export const myLearning = async (req, res) => res.json(await svc.myLearning(me(req)));
export const myEnrollment = async (req, res) => res.json({ item: await svc.myEnrollment(me(req), req.params.enrollmentId) });
export const start = async (req, res) => res.json({ item: await svc.startCourse(me(req), req.params.enrollmentId) });
export const setLesson = async (req, res) => res.json({ item: await svc.setLesson(me(req), req.params.enrollmentId, req.params.lessonId, req.body?.done !== false) });
export const submit = async (req, res) => res.json({ item: await svc.submitEvidence(req.user, req.params.enrollmentId, req.body) });

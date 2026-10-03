import { HttpError } from '../middleware/error.js';
import * as svc from '../services/quiz.service.js';

/* ---- admin + faculty ---- */
export const scope = async (req, res) => res.json(await svc.scope(req.user));
export const list = async (req, res) => res.json({ quizzes: await svc.listQuizzes(req.user) });
export const get = async (req, res) => res.json({ quiz: await svc.getQuiz(req.user, req.params.id) });
export const create = async (req, res) => res.status(201).json({ quiz: await svc.saveQuiz(req.user, null, req.body) });
export const update = async (req, res) => res.json({ quiz: await svc.saveQuiz(req.user, req.params.id, req.body) });
export const remove = async (req, res) => { await svc.deleteQuiz(req.user, req.params.id); res.json({ success: true }); };
export const publish = async (req, res) => res.json({ quiz: await svc.publishQuiz(req.user, req.params.id) });
export const close = async (req, res) => res.json({ quiz: await svc.closeQuiz(req.user, req.params.id) });
export const reopen = async (req, res) => res.json({ quiz: await svc.reopenQuiz(req.user, req.params.id) });
export const results = async (req, res) => res.json(await svc.results(req.user, req.params.id));
export const extraAttempt = async (req, res) => res.json(await svc.grantExtraAttempt(req.user, req.params.id, req.body?.studentId));
export const internalMarks = async (req, res) => res.json(await svc.internalMarks(req.user, req.query));

/* ---- student ---- */
const me = (req) => {
  if (!req.user.studentId) throw new HttpError(403, 'Students only.');
  return req.user.studentId;
};
export const myQuizzes = async (req, res) => res.json(await svc.myQuizzes(me(req)));
export const start = async (req, res) => res.json(await svc.startAttempt(me(req), req.params.id));
export const save = async (req, res) => res.json(await svc.saveAnswers(me(req), req.params.id, req.body?.answers));
export const submit = async (req, res) => res.json(await svc.submitAttempt(me(req), req.params.id, req.body?.answers));
export const myResult = async (req, res) => res.json(await svc.myResult(me(req), req.params.id));
export const myInternalMarks = async (req, res) => res.json(await svc.myInternalMarks(me(req)));

import { Router } from 'express';
import { requireAuth, requireModule, requireRole } from '../middleware/auth.js';
import * as rawAttendance from '../controllers/attendance.controller.js';
import * as rawExams from '../controllers/exams.controller.js';
import * as rawLearning from '../controllers/learning.controller.js';
import * as rawQuizzes from '../controllers/quiz.controller.js';
import { uuidParam, wrapAll } from './wrap.js';

const attendance = wrapAll(rawAttendance);
const exams = wrapAll(rawExams);
const learning = wrapAll(rawLearning);
const quizzes = wrapAll(rawQuizzes);
const router = Router();
router.use(requireAuth, requireRole('employee'));
router.param('paperId', uuidParam);
router.param('id', uuidParam);
router.param('enrollmentId', uuidParam);

// Faculty marking: "today's lectures" come from the Timetable, so both modules must be on
router.use('/attendance', requireModule('attendance'), requireModule('timetable'));
router.get('/attendance/today', attendance.myLectures);
router.get('/attendance/lecture', attendance.getSheet);
router.put('/attendance/lecture', attendance.saveSheet);

// Faculty enter marks only for the papers an admin assigned to them
router.use('/exams', requireModule('exams'));
router.get('/exams/papers', exams.myPapers);
router.get('/exams/papers/:paperId/marks', exams.getMarks);
router.put('/exams/papers/:paperId/marks', exams.saveMarks);

// Learning platform and quizzes: a teacher works with the classes and subjects on their own timetable
router.use('/learning', requireModule('learning'));
router.get('/learning/subjects', learning.subjects);
router.get('/learning/courses', learning.courses);
router.post('/learning/courses', learning.createCourse);
router.get('/learning/courses/:id', learning.course);
router.put('/learning/courses/:id', learning.updateCourse);
router.delete('/learning/courses/:id', learning.deleteCourse);
router.get('/learning/assignments', learning.assignments);
router.post('/learning/assignments', learning.createAssignment);
router.get('/learning/assignments/:id', learning.assignment);
router.put('/learning/assignments/:id', learning.updateAssignment);
router.delete('/learning/assignments/:id', learning.deleteAssignment);
router.post('/learning/assignments/:id/sync', learning.syncAssignment);
router.get('/learning/review', learning.reviewQueue);
router.post('/learning/enrollments/:enrollmentId/review', learning.review);
router.get('/learning/compliance', learning.compliance);

router.use('/quizzes', requireModule('quizzes'));
router.get('/quizzes/scope', quizzes.scope);
router.get('/quizzes/internal-marks', quizzes.internalMarks);
router.get('/quizzes', quizzes.list);
router.post('/quizzes', quizzes.create);
router.get('/quizzes/:id', quizzes.get);
router.put('/quizzes/:id', quizzes.update);
router.delete('/quizzes/:id', quizzes.remove);
router.post('/quizzes/:id/publish', quizzes.publish);
router.post('/quizzes/:id/close', quizzes.close);
router.post('/quizzes/:id/reopen', quizzes.reopen);
router.get('/quizzes/:id/results', quizzes.results);
router.post('/quizzes/:id/extra-attempts', quizzes.extraAttempt);

export default router;

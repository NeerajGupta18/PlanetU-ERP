import { asyncHandler } from '../utils/asyncHandler.js';
import * as todo from '../services/todo.service.js';
import { Router } from 'express';
import { requireAuth, requireModule, requireRole } from '../middleware/auth.js';
import * as rawAttendance from '../controllers/attendance.controller.js';
import * as rawExams from '../controllers/exams.controller.js';
import * as rawLearning from '../controllers/learning.controller.js';
import * as rawQuizzes from '../controllers/quiz.controller.js';
import * as rawNotices from '../controllers/notices.controller.js';
import * as rawGrievance from '../controllers/grievance.controller.js';
import * as rawLeave from '../controllers/leave.controller.js';
import * as rawVisitors from '../controllers/visitors.controller.js';
import * as rawAssignments from '../controllers/assignments.controller.js';
import * as rawCheckin from '../controllers/checkin.controller.js';
import * as rawPayroll from '../controllers/payroll.controller.js';
import { uuidParam, wrapAll } from './wrap.js';

const attendance = wrapAll(rawAttendance);
const exams = wrapAll(rawExams);
const learning = wrapAll(rawLearning);
const quizzes = wrapAll(rawQuizzes);
const notices = wrapAll(rawNotices);
const grievance = wrapAll(rawGrievance);
const leave = wrapAll(rawLeave);
const payroll = wrapAll(rawPayroll);
const checkin = wrapAll(rawCheckin);
const assignments = wrapAll(rawAssignments);
const visitors = wrapAll(rawVisitors);
const router = Router();
router.use(requireAuth, requireRole('employee'));
router.param('paperId', uuidParam);
router.param('id', uuidParam);
router.param('enrollmentId', uuidParam);

router.get('/todo', asyncHandler(async (req, res) => res.json(await todo.forEmployee(req.user, req.tenant.modules))));
router.get('/notices', requireModule('notices'), notices.mine);
router.post('/notices/read-all', requireModule('notices'), notices.readAll);
router.post('/notices/:id/read', requireModule('notices'), notices.read);
router.get('/grievances', requireModule('grievance'), grievance.mine);
router.post('/grievances', requireModule('grievance'), grievance.create);
router.get('/grievances/:id', requireModule('grievance'), grievance.one);
router.post('/grievances/:id/reply', requireModule('grievance'), grievance.reply);
router.post('/grievances/:id/close', requireModule('grievance'), grievance.close);
router.get('/feedback', requireModule('grievance'), grievance.myForms);
router.get('/feedback/:id', requireModule('grievance'), grievance.myForm);
router.post('/feedback/:id', requireModule('grievance'), grievance.submitForm);
router.get('/leave', requireModule('leave'), leave.mine);
router.post('/leave', requireModule('leave'), leave.apply);
router.post('/leave/:id/cancel', requireModule('leave'), leave.cancel);
router.use('/visitors', requireModule('visitors'));
router.get('/visitors/meta', visitors.meta);
router.get('/visitors', visitors.list);
router.post('/visitors', visitors.register);
router.post('/visitors/:id/cancel', visitors.cancel);

router.use('/assignments', requireModule('assignments'));
router.get('/assignments/scope', assignments.scope);
router.get('/assignments', assignments.list);
router.post('/assignments', assignments.create);
router.get('/assignments/:id', assignments.get);
router.put('/assignments/:id', assignments.update);
router.delete('/assignments/:id', assignments.remove);
router.post('/assignments/:id/publish', assignments.publish);
router.post('/assignments/:id/close', assignments.close);
router.post('/assignments/:id/reopen', assignments.reopen);
router.put('/assignments/:id/submissions/:studentId', assignments.grade);
router.get('/payslips', requireModule('payroll'), payroll.mine);
router.get('/payslips/:id/pdf', requireModule('payroll'), payroll.myPdf);

// Faculty marking: "today's lectures" come from the Timetable, so both modules must be on
router.use('/attendance', requireModule('attendance'), requireModule('timetable'));
router.get('/attendance/today', attendance.myLectures);
router.get('/attendance/lecture', attendance.getSheet);
router.put('/attendance/lecture', attendance.saveSheet);
router.get('/attendance/checkin', checkin.state);
router.post('/attendance/checkin', checkin.open);
router.post('/attendance/checkin/close', checkin.close);

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

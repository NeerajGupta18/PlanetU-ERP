import { Router } from 'express';
import multer from 'multer';
import { HttpError } from '../middleware/error.js';
import { IMPORT_LIMITS } from '../services/studentImport.service.js';
import { rebindTx, requireAuth, requireModule, requireRole } from '../middleware/auth.js';
import * as raw from '../controllers/admin.controller.js';
import * as rawAdmissions from '../controllers/admissions.controller.js';
import * as rawCourses from '../controllers/courses.controller.js';
import * as rawStudents from '../controllers/students.controller.js';
import * as rawFees from '../controllers/fees.controller.js';
import * as rawOnline from '../controllers/onlinePayments.controller.js';
import * as rawLibrary from '../controllers/library.controller.js';
import * as rawAssets from '../controllers/assets.controller.js';
import * as rawAttendance from '../controllers/attendance.controller.js';
import * as rawExams from '../controllers/exams.controller.js';
import * as rawReports from '../controllers/reports.controller.js';
import * as rawBilling from '../controllers/billing.controller.js';
import * as rawLearning from '../controllers/learning.controller.js';
import * as rawQuizzes from '../controllers/quiz.controller.js';
import { uuidParam, wrapAll } from './wrap.js';

const admin = wrapAll(raw);
const admissions = wrapAll(rawAdmissions);
const courses = wrapAll(rawCourses);
const students = wrapAll(rawStudents);
const fees = wrapAll(rawFees);
const online = wrapAll(rawOnline);
const library = wrapAll(rawLibrary);
const assets = wrapAll(rawAssets);
const attendance = wrapAll(rawAttendance);
const exams = wrapAll(rawExams);
const reports = wrapAll(rawReports);
const billing = wrapAll(rawBilling);
const learning = wrapAll(rawLearning);
const quizzes = wrapAll(rawQuizzes);
const router = Router();

// CSV uploads for the student import: memory only, one file, hard size cap, with a message that fits
const csvParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1 } }).single('file');
const csvUpload = (req, res, next) => csvParser(req, res, (err) => {
  if (!err) return rebindTx(req, res, next); // see rebindTx: large bodies lose the request's database context
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `That file is too large (${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB at most).`));
  return next(new HttpError(400, 'Could not read the upload. Send one CSV file in the "file" field.'));
});
router.use(requireAuth, requireRole('admin'));
router.param('id', uuidParam);
router.param('docId', uuidParam);
router.param('itemId', uuidParam);
router.param('paperId', uuidParam);
router.param('studentId', uuidParam);
router.param('invoiceId', uuidParam);
router.param('enrollmentId', uuidParam);

router.get('/dashboard', admin.dashboard);
router.get('/audit', admin.listAudit);

router.get('/institute', admin.getInstituteDetails);
router.put('/institute', admin.updateInstituteDetails);
router.post('/institute/authorized-persons', admin.addAuthorizedPerson);
router.put('/institute/authorized-persons/:index', admin.updateAuthorizedPerson);
router.delete('/institute/authorized-persons/:index', admin.removeAuthorizedPerson);
router.post('/institute/stakeholders', admin.addStakeholder);
router.put('/institute/stakeholders/:index', admin.updateStakeholder);
router.delete('/institute/stakeholders/:index', admin.removeStakeholder);
router.post('/institute/documents', admin.addDocument);
router.put('/institute/documents/:index', admin.updateDocument);
router.delete('/institute/documents/:index', admin.removeDocument);
router.post('/institute/beneficiaries', admin.addBeneficiary);
router.put('/institute/beneficiaries/:index', admin.updateBeneficiary);
router.delete('/institute/beneficiaries/:index', admin.removeBeneficiary);
router.put('/institute/stamp', admin.updateStamp);

// Classes / courses / programmes: core to every institute, so no module switch
router.get('/courses', courses.list);
router.post('/courses', courses.create);
router.put('/courses/:id', courses.update);
router.delete('/courses/:id', courses.remove);

router.get('/departments', admin.listDepartments);
router.post('/departments', admin.createDepartment);
router.put('/departments/:id', admin.updateDepartment);
router.delete('/departments/:id', admin.removeDepartment);

router.get('/designations', admin.listDesignations);
router.post('/designations', admin.createDesignation);
router.delete('/designations/:id', admin.removeDesignation);

router.get('/employees', admin.listEmployees);
router.post('/employees', admin.createEmployee);
router.put('/employees/:id', admin.updateEmployee);
router.delete('/employees/:id', admin.removeEmployee);

router.use('/admissions', requireModule('admissions'));
router.get('/admissions', admissions.list);
router.get('/admissions/:id', admissions.get);
router.put('/admissions/:id/documents/:docId', admissions.review);
router.post('/admissions/:id/decision', admissions.decide);
router.post('/admissions/:id/enroll', admissions.enroll);

router.use('/students', requireModule('students'));
router.get('/students/import/template.csv', students.importTemplate);
router.post('/students/import/preview', csvUpload, students.importPreview);
router.post('/students/import', csvUpload, students.importCommit);
router.get('/students', students.list);
router.get('/students/:id', students.get);
router.put('/students/:id', students.update);
router.put('/students/:id/photo', students.setPhoto);
router.get('/students/:id/id-card.pdf', students.idCard);

router.use('/fees', requireModule('fees'));
router.get('/fees/structures', fees.listStructures);
router.post('/fees/structures', fees.createStructure);
router.delete('/fees/structures/:id', fees.deleteStructure);
router.post('/fees/structures/:id/assign', fees.assignStructure);
router.post('/fees/structures/:id/bulk-assign', fees.bulkAssign);
router.get('/fees/payments', fees.listPayments);
router.post('/fees/payments', fees.recordPayment);
router.get('/fees/payments/:id/receipt.pdf', fees.receipt);
router.get('/fees/online-orders', online.listOrders);
router.put('/fees/online-orders/:id/resolve', online.resolveOrder);
router.get('/fees/students/:id', fees.studentFees);
router.post('/fees/students/:id/items', fees.addManualItem);
router.put('/fees/items/:itemId/waive', fees.waiveItem);

router.use('/library', requireModule('library'));
router.get('/library/books', library.listBooks);
router.post('/library/books', library.createBook);
router.get('/library/books/:id', library.getBook);
router.put('/library/books/:id', library.updateBook);
router.delete('/library/books/:id', library.deleteBook);
router.get('/library/issues', library.listIssues);
router.post('/library/issues', library.issueBook);
router.put('/library/issues/:id/return', library.returnBook);
router.put('/library/issues/:id/pay-fine', library.payFine);

router.use('/assets', requireModule('assets'));
router.get('/assets', assets.list);
router.post('/assets', assets.create);
router.get('/assets/:id', assets.get);
router.put('/assets/:id', assets.update);
router.delete('/assets/:id', assets.remove);
router.put('/assets/:id/assign', assets.assign);
router.put('/assets/:id/unassign', assets.unassign);
router.put('/assets/:id/status', assets.setStatus);
router.post('/assets/:id/maintenance', assets.logMaintenance);

router.use('/calendar', requireModule('calendar'));
router.get('/calendar', admin.listEvents);
router.post('/calendar', admin.createEvent);
router.put('/calendar/:id', admin.updateEvent);
router.delete('/calendar/:id', admin.removeEvent);

router.use('/attendance', requireModule('attendance'));
router.get('/attendance/day', attendance.daySheet);
router.get('/attendance/lecture', attendance.getSheet);
router.put('/attendance/lecture', attendance.saveSheet);
router.get('/attendance/report', attendance.report);
router.get('/attendance/report.csv', attendance.reportCsv);

// The institute's own subscription page. Not a module: an institute whose access was paused for non-payment can
// still reach exactly this (see requireAuth), so its admin can pay and be restored on the spot.
router.get('/billing', billing.myBilling);
router.put('/billing/profile', billing.myProfile);
router.post('/billing/choose-plan', billing.myChoosePlan);
router.put('/billing/change', billing.myChange);
router.get('/billing/invoices/:invoiceId/pdf', billing.myInvoicePdf);
router.post('/billing/invoices/:invoiceId/order', billing.myOrder);
router.post('/billing/verify', billing.myVerify);

// Learning platform and quizzes: shared with faculty; the service decides what each role may see and do
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

// Reports are read-only; each one checks for the module it draws on
router.get('/reports', reports.catalogue);
router.get('/reports/:key', reports.run);

router.use('/exams', requireModule('exams'));
router.get('/exams', exams.listExams);
router.post('/exams', exams.createExam);
router.get('/exams/grading', exams.getGrading);
router.put('/exams/grading', exams.setGrading);
router.delete('/exams/grading', exams.resetGrading);
router.get('/exams/:id', exams.getExam);
router.put('/exams/:id', exams.updateExam);
router.delete('/exams/:id', exams.deleteExam);
router.post('/exams/:id/papers', exams.addPaper);
router.put('/exams/:id/papers/:paperId', exams.updatePaper);
router.delete('/exams/:id/papers/:paperId', exams.deletePaper);
router.get('/exams/:id/papers/:paperId/marks', exams.getMarks);
router.put('/exams/:id/papers/:paperId/marks', exams.saveMarks);
router.post('/exams/:id/publish', exams.publish);
router.post('/exams/:id/unpublish', exams.unpublish);
router.get('/exams/:id/results', exams.results);
router.get('/exams/:id/results.csv', exams.resultsCsv);
router.get('/exams/:id/report-cards.pdf', exams.reportCards);
router.get('/exams/:id/students/:studentId/report-card.pdf', exams.reportCard);

router.use('/timetable', requireModule('timetable'));
router.get('/timetable/filters', admin.timetableFilters);
router.get('/timetable', admin.listTimetable);
router.get('/timetable/slots', admin.listSlots);
router.post('/timetable/slots', admin.createSlot);
router.put('/timetable/slots/:id', admin.updateSlot);
router.delete('/timetable/slots/:id', admin.removeSlot);
router.put('/timetable/reassign', admin.reassign);
router.put('/timetable/reassign/undo', admin.undoReassign);

export default router;

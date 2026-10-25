import { Router } from 'express';
import multer from 'multer';
import { HttpError } from '../middleware/error.js';
import { IMPORT_LIMITS } from '../services/studentImport.service.js';
import { MAX_BYTES } from '../services/files.service.js';
import { rebindTx, requireAuth, requireModule } from '../middleware/auth.js';
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
import * as rawNotices from '../controllers/notices.controller.js';
import * as rawCertificates from '../controllers/certificates.controller.js';
import * as rawLeave from '../controllers/leave.controller.js';
import * as rawAssignments from '../controllers/assignments.controller.js';
import { officeAccess } from '../middleware/office.js';
import * as rawStaff from '../controllers/staff.controller.js';
import * as rawInbox from '../controllers/inbox.controller.js';
import * as rawVisitors from '../controllers/visitors.controller.js';
import * as rawPlacement from '../controllers/placement.controller.js';
import * as rawHostel from '../controllers/hostel.controller.js';
import * as rawTransport from '../controllers/transport.controller.js';
import * as rawPayroll from '../controllers/payroll.controller.js';
import * as rawGrievance from '../controllers/grievance.controller.js';
import * as rawParents from '../controllers/parents.controller.js';
import * as rawSetup from '../controllers/setup.controller.js';
import { LOGO_MAX_BYTES } from '../services/setup.service.js';
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
const notices = wrapAll(rawNotices);
const certificates = wrapAll(rawCertificates);
const leave = wrapAll(rawLeave);
const hostel = wrapAll(rawHostel);
const placement = wrapAll(rawPlacement);
const visitors = wrapAll(rawVisitors);
const inbox = wrapAll(rawInbox);
const staff = wrapAll(rawStaff);
const assignments = wrapAll(rawAssignments);
const transport = wrapAll(rawTransport);
const payroll = wrapAll(rawPayroll);
const grievance = wrapAll(rawGrievance);
const parents = wrapAll(rawParents);
const setup = wrapAll(rawSetup);
const router = Router();

// CSV uploads for the student import: memory only, one file, hard size cap, with a message that fits
const csvParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1 } }).single('file');
const csvUpload = (req, res, next) => csvParser(req, res, (err) => {
  if (!err) return rebindTx(req, res, next); // see rebindTx: large bodies lose the request's database context
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `That file is too large (${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB at most).`));
  return next(new HttpError(400, 'Could not read the upload. Send one CSV file in the "file" field.'));
});
// Scanned documents the office uploads for a walk-in applicant: same cap and bytes check as every other upload
const docParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('file');
const docUpload = (req, res, next) => docParser(req, res, (err) => {
  if (!err) return rebindTx(req, res, next);
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'That file is too large (5 MB at most).'));
  return next(new HttpError(400, 'Could not read the upload. Send one file in the "file" field.'));
});
// The institute's logo: one PNG or JPG picture, checked again by its bytes in setup.service.js
const logoParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }).single('file');
const logoUpload = (req, res, next) => logoParser(req, res, (err) => {
  if (!err) return rebindTx(req, res, next);
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `That picture is too large. Use one under ${LOGO_MAX_BYTES / 1024} KB (a 512 x 512 PNG is plenty).`));
  return next(new HttpError(400, 'Could not read the upload. Choose one PNG or JPG picture.'));
});
// The institute admin uses all of this; employees with staff roles use the parts their roles grant (middleware/office.js)
router.use(requireAuth, officeAccess);
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
router.get('/admissions/settings', admissions.getSettings);
router.put('/admissions/settings', admissions.updateSettings);
router.get('/admissions/merit-list', admissions.meritList);
router.post('/admissions/walk-in', admissions.walkIn);
router.post('/admissions/bulk-decision', admissions.bulkDecide);
router.get('/admissions/board', admissions.board);
router.post('/admissions/enquiries', admissions.createEnquiry);
router.get('/admissions/enquiries/:id', admissions.getEnquiry);
router.post('/admissions/enquiries/:id/form-link', admissions.sendFormLink);
router.delete('/admissions/enquiries/:id', admissions.removeEnquiry);
router.get('/admissions/:id', admissions.get);
router.post('/admissions/:id/documents', docUpload, admissions.uploadDocument);
router.put('/admissions/:id/fee', admissions.setFee);
router.put('/admissions/:id/merit', admissions.setMerit);
router.put('/admissions/:id/documents/:docId', admissions.review);
router.post('/admissions/:id/decision', admissions.decide);
router.get('/admissions/:id/enrol-plan', admissions.enrolPlan);
router.post('/admissions/:id/enroll', admissions.enroll);

router.use('/students', requireModule('students'));
router.get('/students/import/template.csv', students.importTemplate);
router.post('/students/import/preview', csvUpload, students.importPreview);
router.post('/students/import', csvUpload, students.importCommit);
router.post('/students/parents/invite-all', requireModule('parent_portal'), parents.inviteAll);
router.get('/students', students.list);
router.get('/students/:id', students.get);
router.get('/students/:id/overview', students.overview);
router.put('/students/:id', students.update);
router.put('/students/:id/photo', students.setPhoto);
router.param('userId', uuidParam);
router.param('subjectId', uuidParam);
router.get('/students/:id/parents', requireModule('parent_portal'), parents.list);
router.post('/students/:id/parents', requireModule('parent_portal'), parents.add);
router.delete('/students/:id/parents/:userId', requireModule('parent_portal'), parents.remove);
router.get('/students/:id/id-card.pdf', students.idCard);

router.use('/fees', requireModule('fees'));
router.get('/fees/summary', fees.summary);
router.get('/fees/class-dues', fees.classDues);
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
router.put('/fees/items/:itemId/concession', fees.concession);
router.post('/fees/late-fees', fees.lateFees);
router.get('/fees/reminders', fees.reminders);
router.post('/fees/reminders', fees.sendReminders);
router.get('/fees/day-end', fees.dayEnd);

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

router.use('/notices', requireModule('notices'));
router.get('/notices', notices.list);
router.post('/notices', notices.create);
router.put('/notices/:id', notices.update);
router.delete('/notices/:id', notices.remove);

router.use('/certificates', requireModule('certificates'));
router.get('/certificates', certificates.list);
router.post('/certificates', certificates.issue);
router.put('/certificates/:id', certificates.decide);
router.get('/certificates/:id/pdf', certificates.pdf);

router.use('/leave', requireModule('leave'));
router.get('/leave', leave.list);
router.post('/leave', leave.record);
router.get('/leave/balances', leave.balances);
router.get('/leave/on-leave', leave.onLeave);
router.get('/leave/types', leave.types);
router.post('/leave/types', leave.createType);
router.post('/leave/types/defaults', leave.standardTypes);
router.put('/leave/types/:id', leave.updateType);
router.delete('/leave/types/:id', leave.removeType);
router.put('/leave/:id', leave.decide);

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

router.get('/staff-roles', staff.list);
router.post('/staff-roles', staff.grant);
router.delete('/staff-roles/:employeeId/:role', staff.revoke);

router.get('/approvals', inbox.approvalsList);
router.get('/setup-status', inbox.setup);

// The seven-step setup wizard (institute admin only: no staff role grants "setup")
router.get('/setup', setup.wizard);
router.put('/setup/brand', setup.saveBrand);
router.post('/setup/logo', logoUpload, setup.saveLogo);
router.delete('/setup/logo', setup.removeLogo);
router.put('/setup/year', setup.saveYear);
router.put('/setup/divisions/:id', setup.saveDivisions);
router.post('/setup/subjects', setup.addSubject);
router.delete('/setup/subjects/:subjectId', setup.removeSubject);
router.post('/setup/teachers', setup.addTeacher);
router.post('/setup/invite', setup.invite);
router.put('/setup/sample-data', setup.sampleData);
router.get('/setup/staff-import/template.csv', setup.staffTemplate);
router.post('/setup/staff-import/preview', csvUpload, setup.staffPreview);
router.post('/setup/staff-import', csvUpload, setup.staffCommit);

router.use('/visitors', requireModule('visitors'));
router.get('/visitors/meta', visitors.meta);
router.get('/visitors/summary', visitors.summary);
router.get('/visitors', visitors.list);
router.post('/visitors', visitors.register);
router.post('/visitors/:id/check-in', visitors.checkIn);
router.post('/visitors/:id/check-out', visitors.checkOut);
router.post('/visitors/:id/cancel', visitors.cancel);

router.use('/placement', requireModule('placement'));
router.get('/placement/stats', placement.stats);
router.get('/placement/companies', placement.companies);
router.post('/placement/companies', placement.createCompany);
router.put('/placement/companies/:id', placement.updateCompany);
router.delete('/placement/companies/:id', placement.removeCompany);
router.get('/placement/drives', placement.drives);
router.post('/placement/drives', placement.createDrive);
router.get('/placement/drives/:id', placement.drive);
router.put('/placement/drives/:id', placement.updateDrive);
router.delete('/placement/drives/:id', placement.removeDrive);
router.post('/placement/drives/:id/open', placement.openDrive);
router.post('/placement/drives/:id/close', placement.closeDrive);
router.put('/placement/applications/:id', placement.decide);

router.use('/hostel', requireModule('hostel'));
router.get('/hostel', hostel.hostels);
router.post('/hostel', hostel.createHostel);
router.get('/hostel/stays', hostel.stays);
router.post('/hostel/stays', hostel.allot);
router.put('/hostel/stays/:id/vacate', hostel.vacate);
router.put('/hostel/stays/:id/transfer', hostel.transfer);
router.put('/hostel/rooms/:id', hostel.updateRoom);
router.delete('/hostel/rooms/:id', hostel.removeRoom);
router.get('/hostel/:id/rooms', hostel.rooms);
router.post('/hostel/:id/rooms', hostel.createRooms);
router.put('/hostel/:id', hostel.updateHostel);
router.delete('/hostel/:id', hostel.removeHostel);

router.use('/transport', requireModule('transport'));
router.get('/transport', transport.routes);
router.post('/transport', transport.createRoute);
router.get('/transport/rides', transport.rides);
router.post('/transport/rides', transport.assign);
router.put('/transport/rides/:id/end', transport.endRide);
router.put('/transport/rides/:id/change', transport.change);
router.put('/transport/:id', transport.updateRoute);
router.delete('/transport/:id', transport.removeRoute);

router.use('/payroll', requireModule('payroll'));
router.get('/payroll/salaries', payroll.salaries);
router.put('/payroll/salaries/:id', payroll.setSalary);
router.delete('/payroll/salaries/:id', payroll.removeSalary);
router.get('/payroll/runs', payroll.runs);
router.post('/payroll/runs', payroll.createRun);
router.get('/payroll/runs/:id', payroll.getRun);
router.post('/payroll/runs/:id/finalise', payroll.finalise);
router.delete('/payroll/runs/:id', payroll.removeRun);
router.get('/payroll/payslips/:id/pdf', payroll.pdf);

router.use('/grievances', requireModule('grievance'));
router.get('/grievances', grievance.list);
router.get('/grievances/:id', grievance.adminOne);
router.post('/grievances/:id/reply', grievance.adminReply);
router.use('/feedback', requireModule('grievance'));
router.get('/feedback', grievance.forms);
router.post('/feedback', grievance.createForm);
router.get('/feedback/:id', grievance.form);
router.put('/feedback/:id', grievance.updateForm);
router.put('/feedback/:id/status', grievance.formStatus);
router.delete('/feedback/:id', grievance.removeForm);
router.get('/feedback/:id/results', grievance.results);

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

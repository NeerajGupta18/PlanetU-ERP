import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ROLE_HOME } from './config/menu.config.js';
import AppShell from './components/layout/AppShell.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import { FullPageLoader } from './components/ui/Feedback.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import ModuleGate from './components/auth/ModuleGate.jsx';
import { installedOnIos } from './lib/install.js';

// Pages load on demand, so the first visit downloads only what the sign-in page and the shell need
const Help = lazy(() => import('./pages/shared/Help.jsx'));
const StudentAssignments = lazy(() => import('./pages/student/Assignments.jsx'));
const StudentAssignmentView = lazy(() => import('./pages/student/Assignments.jsx').then((m) => ({ default: m.AssignmentView })));
const Assignments = lazy(() => import('./pages/shared/Assignments.jsx'));
const AssignmentDetail = lazy(() => import('./pages/shared/Assignments.jsx').then((m) => ({ default: m.AssignmentDetail })));
const AdminPlacement = lazy(() => import('./pages/admin/Placement.jsx'));
const AdminDriveDetail = lazy(() => import('./pages/admin/Placement.jsx').then((m) => ({ default: m.DriveDetail })));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const StudentDashboard = lazy(() => import('./pages/student/Dashboard.jsx'));
const StudentProfile = lazy(() => import('./pages/student/Profile.jsx'));
const StudentInstitute = lazy(() => import('./pages/student/Institute.jsx'));
const StudentCalendar = lazy(() => import('./pages/student/Calendar.jsx'));
const StudentTimetable = lazy(() => import('./pages/student/Timetable.jsx'));
const StudentAttendance = lazy(() => import('./pages/student/Attendance.jsx'));
const EmployeeDashboard = lazy(() => import('./pages/employee/Dashboard.jsx'));
const EmployeeAttendance = lazy(() => import('./pages/employee/Attendance.jsx'));
const AdminAttendance = lazy(() => import('./pages/admin/Attendance.jsx'));
const AdminExams = lazy(() => import('./pages/admin/Exams.jsx'));
const AdminReports = lazy(() => import('./pages/admin/Reports.jsx'));
const AdminBilling = lazy(() => import('./pages/admin/Billing.jsx'));
const AdminExamDetail = lazy(() => import('./pages/admin/ExamDetail.jsx'));
const StudentResults = lazy(() => import('./pages/student/Results.jsx'));
const EmployeeExams = lazy(() => import('./pages/employee/Exams.jsx'));
const EnterMarks = lazy(() => import('./pages/shared/EnterMarks.jsx'));
const MarkAttendance = lazy(() => import('./pages/shared/MarkAttendance.jsx'));
const StudentLearning = lazy(() => import('./pages/student/Learning.jsx'));
const StudentLearningCourse = lazy(() => import('./pages/student/LearningCourse.jsx'));
const StudentQuizzes = lazy(() => import('./pages/student/Quizzes.jsx'));
const QuizTake = lazy(() => import('./pages/student/QuizTake.jsx'));
const QuizResult = lazy(() => import('./pages/student/QuizResult.jsx'));
const LearningManage = lazy(() => import('./pages/shared/LearningManage.jsx'));
const LearningAssignment = lazy(() => import('./pages/shared/LearningAssignment.jsx'));
const QuizManage = lazy(() => import('./pages/shared/QuizManage.jsx'));
const QuizEditor = lazy(() => import('./pages/shared/QuizEditor.jsx'));
const QuizResults = lazy(() => import('./pages/shared/QuizResults.jsx'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const AdminInstitute = lazy(() => import('./pages/admin/Institute.jsx'));
const AdminSetup = lazy(() => import('./pages/admin/Setup.jsx'));
const AdminDepartments = lazy(() => import('./pages/admin/Departments.jsx'));
const AdminCourses = lazy(() => import('./pages/admin/Courses.jsx'));
const AdminEmployees = lazy(() => import('./pages/admin/Employees.jsx'));
const AdminCalendar = lazy(() => import('./pages/admin/Calendar.jsx'));
const AdminTimetable = lazy(() => import('./pages/admin/Timetable.jsx'));
const AdminAdmissions = lazy(() => import('./pages/admin/Admissions.jsx'));
const AdminNotices = lazy(() => import('./pages/admin/Notices.jsx'));
const AdminCertificates = lazy(() => import('./pages/admin/Certificates.jsx'));
const StudentNotices = lazy(() => import('./pages/student/Notices.jsx'));
const StudentCertificates = lazy(() => import('./pages/student/Certificates.jsx'));
const EmployeeNotices = lazy(() => import('./pages/employee/Notices.jsx'));
const EmployeeLeave = lazy(() => import('./pages/employee/Leave.jsx'));
const AdminLeave = lazy(() => import('./pages/admin/Leave.jsx'));
const AdminStaffRoles = lazy(() => import('./pages/admin/StaffRoles.jsx'));
const AdminApprovals = lazy(() => import('./pages/admin/Approvals.jsx'));
const AdminAssistants = lazy(() => import('./pages/admin/Assistants.jsx'));
const StudentCheckin = lazy(() => import('./pages/student/Checkin.jsx'));
const StudentPlacement = lazy(() => import('./pages/student/Placement.jsx'));
const Visitors = lazy(() => import('./pages/shared/Visitors.jsx'));
const AdminHostel = lazy(() => import('./pages/admin/Hostel.jsx'));
const AdminTransport = lazy(() => import('./pages/admin/Transport.jsx'));
const AdminPayroll = lazy(() => import('./pages/admin/Payroll.jsx'));
const StudentHostel = lazy(() => import('./pages/student/Hostel.jsx'));
const StudentTransport = lazy(() => import('./pages/student/Transport.jsx'));
const EmployeePayslips = lazy(() => import('./pages/employee/Payslips.jsx'));
const AdminGrievances = lazy(() => import('./pages/admin/Grievances.jsx'));
const AdminFeedback = lazy(() => import('./pages/admin/Feedback.jsx'));
const StudentSupport = lazy(() => import('./pages/student/Support.jsx'));
const ParentHome = lazy(() => import('./pages/parent/Home.jsx'));
const Support = lazy(() => import('./pages/shared/Support.jsx'));
const EmployeeSupport = lazy(() => import('./pages/employee/Support.jsx'));
const AdminStudents = lazy(() => import('./pages/admin/Students.jsx'));
const AdminStudentImport = lazy(() => import('./pages/admin/StudentImport.jsx'));
const AdminFees = lazy(() => import('./pages/admin/Fees.jsx'));
const StudentFees = lazy(() => import('./pages/student/Fees.jsx'));
const AdminLibrary = lazy(() => import('./pages/admin/Library.jsx'));
const AdminAssets = lazy(() => import('./pages/admin/Assets.jsx'));
const StudentLibrary = lazy(() => import('./pages/student/Library.jsx'));
const Apply = lazy(() => import('./pages/public/Apply.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const ChangePassword = lazy(() => import('./pages/ChangePassword.jsx'));
const ApplyStatus = lazy(() => import('./pages/public/ApplyStatus.jsx'));
const InstalledDocs = lazy(() => import('./components/campus/InstalledDocs.jsx'));
const loadLanding = () => import('./pages/public/Landing.jsx');
const Landing = lazy(loadLanding);
const Privacy = lazy(() => import('./pages/public/Privacy.jsx'));
const Consent = lazy(() => import('./pages/Consent.jsx'));
const SuperAdminDemoRequests = lazy(() => import('./pages/superadmin/DemoRequests.jsx'));
const SuperAdminDashboard = lazy(() => import('./pages/superadmin/Dashboard.jsx'));
const SuperAdminBilling = lazy(() => import('./pages/superadmin/Billing.jsx'));
const SuperAdminInstitutes = lazy(() => import('./pages/superadmin/Institutes.jsx'));

// Inside the Android app or an installed home-screen app, people come to sign in, not to read the front page
const inApp = () => /PlanetUApp/.test(navigator.userAgent) || window.navigator.standalone === true
  || window.matchMedia?.('(display-mode: standalone)').matches;

// A browser opening the front page: fetch the page and its first screen while the sign-in check runs, not after it
if (window.location.pathname === '/' && !inApp()) {
  loadLanding();
  const hero = Object.assign(document.createElement('link'), { rel: 'preload', as: 'image', fetchPriority: 'high' });
  hero.setAttribute('imagesrcset', '/landing/admin-dashboard-sm.webp 640w, /landing/admin-dashboard.webp 1280w');
  hero.setAttribute('imagesizes', '(max-width: 640px) 240px, (max-width: 1023px) 92vw, 640px');
  document.head.appendChild(hero);
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return inApp() ? <Navigate to="/login" replace /> : <Landing />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<FullPageLoader />}>
    {installedOnIos() && <InstalledDocs />}
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute />}><Route path="/change-password" element={<ChangePassword />} /></Route>
      <Route element={<ProtectedRoute />}><Route path="/consent" element={<Consent />} /></Route>
      <Route path="/privacy" element={<Privacy />} />

      {/* Public admissions (no sign-in) */}
      <Route path="/apply/:code" element={<Apply />} />
      <Route path="/apply/:code/status" element={<ApplyStatus />} />

      {/* Phase 1: Student portal */}
      <Route element={<ProtectedRoute roles={['parent']} />}>
        <Route path="/parent" element={<AppShell />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<ParentHome />} />
          <Route path="help" element={<Help />} />
          <Route element={<ModuleGate module="grievance" />}><Route path="support" element={<Support base="/parent" />} /></Route>
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['student', 'parent']} />}>
        <Route path="/student" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="help" element={<Help />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="institute" element={<StudentInstitute />} />
          <Route element={<ModuleGate module="calendar" />}><Route path="calendar" element={<StudentCalendar />} /></Route>
          <Route element={<ModuleGate module="fees" />}><Route path="fees" element={<StudentFees />} /></Route>
          <Route element={<ModuleGate module="notices" />}><Route path="notices" element={<StudentNotices />} /></Route>
          <Route element={<ModuleGate module="certificates" />}><Route path="certificates" element={<StudentCertificates />} /></Route>
          <Route element={<ModuleGate module="grievance" />}><Route path="support" element={<StudentSupport />} /></Route>
          <Route element={<ModuleGate module="library" />}><Route path="library" element={<StudentLibrary />} /></Route>
          <Route element={<ModuleGate module="hostel" />}><Route path="hostel" element={<StudentHostel />} /></Route>
          <Route element={<ModuleGate module="assignments" />}>
            <Route path="assignments" element={<StudentAssignments />} />
            <Route path="assignments/:id" element={<StudentAssignmentView />} />
          </Route>
          <Route element={<ModuleGate module="attendance" />}><Route path="checkin" element={<StudentCheckin />} /></Route>
          <Route element={<ModuleGate module="placement" />}><Route path="placement" element={<StudentPlacement />} /></Route>
          <Route element={<ModuleGate module="transport" />}><Route path="transport" element={<StudentTransport />} /></Route>
          <Route element={<ModuleGate module="timetable" />}><Route path="timetable" element={<StudentTimetable />} /></Route>
          <Route element={<ModuleGate module="attendance" />}><Route path="attendance" element={<StudentAttendance />} /></Route>
          <Route element={<ModuleGate module="exams" />}><Route path="results" element={<StudentResults />} /></Route>
          <Route element={<ModuleGate module="learning" />}>
            <Route path="learning" element={<StudentLearning />} />
            <Route path="learning/:enrollmentId" element={<StudentLearningCourse />} />
          </Route>
          <Route element={<ModuleGate module="quizzes" />}>
            <Route path="quizzes" element={<StudentQuizzes />} />
            <Route path="quizzes/:id/take" element={<QuizTake />} />
            <Route path="quizzes/:id/result" element={<QuizResult />} />
          </Route>
        </Route>
      </Route>

      {/* Phase 2: Admin portal */}
      <Route element={<ProtectedRoute roles={['admin']} office />}>
        <Route path="/admin" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="help" element={<Help />} />
          <Route path="setup" element={<AdminSetup />} />
          <Route path="institute" element={<AdminInstitute />} />
          <Route path="departments" element={<AdminDepartments />} />
          <Route path="courses" element={<AdminCourses />} />
          <Route path="employees" element={<AdminEmployees />} />
          <Route element={<ModuleGate module="admissions" />}><Route path="admissions" element={<AdminAdmissions />} /></Route>
          <Route element={<ModuleGate module="students" />}>
            <Route path="students" element={<AdminStudents />} />
            <Route path="students/import" element={<AdminStudentImport />} />
          </Route>
          <Route element={<ModuleGate module="fees" />}><Route path="fees" element={<AdminFees />} /></Route>
          <Route element={<ModuleGate module="notices" />}><Route path="notices" element={<AdminNotices />} /></Route>
          <Route element={<ModuleGate module="certificates" />}><Route path="certificates" element={<AdminCertificates />} /></Route>
          <Route element={<ModuleGate module="leave" />}><Route path="leave" element={<AdminLeave />} /></Route>
          <Route element={<ModuleGate module="hostel" />}><Route path="hostel" element={<AdminHostel />} /></Route>
          <Route element={<ModuleGate module="assignments" />}>
            <Route path="assignments" element={<Assignments role="admin" />} />
            <Route path="assignments/:id" element={<AssignmentDetail role="admin" />} />
          </Route>
          <Route path="approvals" element={<AdminApprovals />} />
          <Route path="assistants" element={<AdminAssistants />} />
          <Route path="staff-roles" element={<AdminStaffRoles />} />
          <Route element={<ModuleGate module="visitors" />}><Route path="visitors" element={<Visitors role="admin" />} /></Route>
          <Route element={<ModuleGate module="placement" />}>
            <Route path="placement" element={<AdminPlacement />} />
            <Route path="placement/drives/:id" element={<AdminDriveDetail />} />
          </Route>
          <Route element={<ModuleGate module="transport" />}><Route path="transport" element={<AdminTransport />} /></Route>
          <Route element={<ModuleGate module="payroll" />}><Route path="payroll" element={<AdminPayroll />} /></Route>
          <Route element={<ModuleGate module="grievance" />}>
            <Route path="grievances" element={<AdminGrievances />} />
            <Route path="feedback" element={<AdminFeedback />} />
          </Route>
          <Route element={<ModuleGate module="library" />}><Route path="library" element={<AdminLibrary />} /></Route>
          <Route element={<ModuleGate module="assets" />}><Route path="assets" element={<AdminAssets />} /></Route>
          <Route element={<ModuleGate module="calendar" />}><Route path="calendar" element={<AdminCalendar />} /></Route>
          <Route element={<ModuleGate module="timetable" />}><Route path="timetable" element={<AdminTimetable />} /></Route>
          <Route path="reports" element={<AdminReports />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route element={<ModuleGate module="learning" />}>
            <Route path="learning" element={<LearningManage role="admin" />} />
            <Route path="learning/assignments/:id" element={<LearningAssignment role="admin" />} />
          </Route>
          <Route element={<ModuleGate module="quizzes" />}>
            <Route path="quizzes" element={<QuizManage role="admin" />} />
            <Route path="quizzes/new" element={<QuizEditor role="admin" />} />
            <Route path="quizzes/:id" element={<QuizEditor role="admin" />} />
            <Route path="quizzes/:id/results" element={<QuizResults role="admin" />} />
          </Route>
          <Route element={<ModuleGate module="exams" />}>
            <Route path="exams" element={<AdminExams />} />
            <Route path="exams/:id" element={<AdminExamDetail />} />
            <Route path="exams/:id/marks/:paperId" element={<EnterMarks role="admin" />} />
          </Route>
          <Route element={<ModuleGate module="attendance" />}>
            <Route path="attendance" element={<AdminAttendance />} />
            <Route path="attendance/:slotId" element={<MarkAttendance role="admin" backTo="/admin/attendance" />} />
          </Route>
        </Route>
      </Route>

      {/* Vendor console (platform level) */}
      <Route element={<ProtectedRoute roles={['super_admin']} />}>
        <Route path="/super-admin" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<SuperAdminDashboard />} />
          <Route path="help" element={<Help />} />
          <Route path="institutes" element={<SuperAdminInstitutes />} />
          <Route path="billing" element={<SuperAdminBilling />} />
          <Route path="demo-requests" element={<SuperAdminDemoRequests />} />
        </Route>
      </Route>

      {/* Faculty / employee portal */}
      <Route element={<ProtectedRoute roles={['employee']} />}>
        <Route path="/employee" element={<AppShell />}>
          <Route element={<ModuleGate module="notices" />}><Route path="notices" element={<EmployeeNotices />} /></Route>
          <Route element={<ModuleGate module="leave" />}><Route path="leave" element={<EmployeeLeave />} /></Route>
          <Route element={<ModuleGate module="payroll" />}><Route path="payslips" element={<EmployeePayslips />} /></Route>
          <Route element={<ModuleGate module="grievance" />}><Route path="support" element={<EmployeeSupport />} /></Route>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<EmployeeDashboard />} />
          <Route element={<ModuleGate module="attendance" />}><Route path="assistants" element={<AdminAssistants />} /></Route>
          <Route path="help" element={<Help />} />
          <Route element={<ModuleGate module="learning" />}>
            <Route path="learning" element={<LearningManage role="employee" />} />
            <Route path="learning/assignments/:id" element={<LearningAssignment role="employee" />} />
          </Route>
          <Route element={<ModuleGate module="quizzes" />}>
            <Route path="quizzes" element={<QuizManage role="employee" />} />
            <Route path="quizzes/new" element={<QuizEditor role="employee" />} />
            <Route path="quizzes/:id" element={<QuizEditor role="employee" />} />
            <Route path="quizzes/:id/results" element={<QuizResults role="employee" />} />
          </Route>
          <Route element={<ModuleGate module="visitors" />}><Route path="visitors" element={<Visitors role="employee" />} /></Route>
          <Route element={<ModuleGate module="assignments" />}>
            <Route path="assignments" element={<Assignments role="employee" />} />
            <Route path="assignments/:id" element={<AssignmentDetail role="employee" />} />
          </Route>
          <Route element={<ModuleGate module="exams" />}>
            <Route path="exams" element={<EmployeeExams />} />
            <Route path="exams/:paperId" element={<EnterMarks role="employee" />} />
          </Route>
          <Route element={<ModuleGate module="attendance" />}>
            <Route path="attendance" element={<EmployeeAttendance />} />
            <Route path="attendance/:slotId" element={<MarkAttendance role="employee" backTo="/employee/attendance" />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}

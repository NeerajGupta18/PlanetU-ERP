import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ROLE_HOME } from './config/menu.config.js';
import AppShell from './components/layout/AppShell.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import { FullPageLoader } from './components/ui/Feedback.jsx';
import Login from './pages/Login.jsx';
import ModuleGate from './components/auth/ModuleGate.jsx';
import NotFound from './pages/NotFound.jsx';
import StudentDashboard from './pages/student/Dashboard.jsx';
import StudentProfile from './pages/student/Profile.jsx';
import StudentInstitute from './pages/student/Institute.jsx';
import StudentCalendar from './pages/student/Calendar.jsx';
import StudentTimetable from './pages/student/Timetable.jsx';
import StudentAttendance from './pages/student/Attendance.jsx';
import EmployeeDashboard from './pages/employee/Dashboard.jsx';
import EmployeeAttendance from './pages/employee/Attendance.jsx';
import AdminAttendance from './pages/admin/Attendance.jsx';
import AdminExams from './pages/admin/Exams.jsx';
import AdminReports from './pages/admin/Reports.jsx';
import AdminBilling from './pages/admin/Billing.jsx';
import AdminExamDetail from './pages/admin/ExamDetail.jsx';
import StudentResults from './pages/student/Results.jsx';
import EmployeeExams from './pages/employee/Exams.jsx';
import EnterMarks from './pages/shared/EnterMarks.jsx';
import MarkAttendance from './pages/shared/MarkAttendance.jsx';
import StudentLearning from './pages/student/Learning.jsx';
import StudentLearningCourse from './pages/student/LearningCourse.jsx';
import StudentQuizzes from './pages/student/Quizzes.jsx';
import QuizTake from './pages/student/QuizTake.jsx';
import QuizResult from './pages/student/QuizResult.jsx';
import LearningManage from './pages/shared/LearningManage.jsx';
import LearningAssignment from './pages/shared/LearningAssignment.jsx';
import QuizManage from './pages/shared/QuizManage.jsx';
import QuizEditor from './pages/shared/QuizEditor.jsx';
import QuizResults from './pages/shared/QuizResults.jsx';
import AdminDashboard from './pages/admin/Dashboard.jsx';
import AdminInstitute from './pages/admin/Institute.jsx';
import AdminDepartments from './pages/admin/Departments.jsx';
import AdminCourses from './pages/admin/Courses.jsx';
import AdminEmployees from './pages/admin/Employees.jsx';
import AdminCalendar from './pages/admin/Calendar.jsx';
import AdminTimetable from './pages/admin/Timetable.jsx';
import AdminAdmissions from './pages/admin/Admissions.jsx';
import AdminNotices from './pages/admin/Notices.jsx';
import AdminCertificates from './pages/admin/Certificates.jsx';
import StudentNotices from './pages/student/Notices.jsx';
import StudentCertificates from './pages/student/Certificates.jsx';
import EmployeeNotices from './pages/employee/Notices.jsx';
import EmployeeLeave from './pages/employee/Leave.jsx';
import AdminLeave from './pages/admin/Leave.jsx';
import AdminPlacement, { DriveDetail as AdminDriveDetail } from './pages/admin/Placement.jsx';
import Assignments, { AssignmentDetail } from './pages/shared/Assignments.jsx';
import StudentAssignments, { AssignmentView as StudentAssignmentView } from './pages/student/Assignments.jsx';
import StudentCheckin from './pages/student/Checkin.jsx';
import StudentPlacement from './pages/student/Placement.jsx';
import AdminHostel from './pages/admin/Hostel.jsx';
import AdminTransport from './pages/admin/Transport.jsx';
import AdminPayroll from './pages/admin/Payroll.jsx';
import StudentHostel from './pages/student/Hostel.jsx';
import StudentTransport from './pages/student/Transport.jsx';
import EmployeePayslips from './pages/employee/Payslips.jsx';
import AdminGrievances from './pages/admin/Grievances.jsx';
import AdminFeedback from './pages/admin/Feedback.jsx';
import StudentSupport from './pages/student/Support.jsx';
import ParentHome from './pages/parent/Home.jsx';
import Support from './pages/shared/Support.jsx';
import EmployeeSupport from './pages/employee/Support.jsx';
import AdminStudents from './pages/admin/Students.jsx';
import AdminStudentImport from './pages/admin/StudentImport.jsx';
import AdminFees from './pages/admin/Fees.jsx';
import StudentFees from './pages/student/Fees.jsx';
import AdminLibrary from './pages/admin/Library.jsx';
import AdminAssets from './pages/admin/Assets.jsx';
import StudentLibrary from './pages/student/Library.jsx';
import Apply from './pages/public/Apply.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import ApplyStatus from './pages/public/ApplyStatus.jsx';
import SuperAdminDashboard from './pages/superadmin/Dashboard.jsx';
import SuperAdminBilling from './pages/superadmin/Billing.jsx';
import SuperAdminInstitutes from './pages/superadmin/Institutes.jsx';

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute />}><Route path="/change-password" element={<ChangePassword />} /></Route>

      {/* Public admissions (no sign-in) */}
      <Route path="/apply/:code" element={<Apply />} />
      <Route path="/apply/:code/status" element={<ApplyStatus />} />

      {/* Phase 1: Student portal */}
      <Route element={<ProtectedRoute roles={['parent']} />}>
        <Route path="/parent" element={<AppShell />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<ParentHome />} />
          <Route element={<ModuleGate module="grievance" />}><Route path="support" element={<Support base="/parent" />} /></Route>
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['student', 'parent']} />}>
        <Route path="/student" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<StudentDashboard />} />
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
      <Route element={<ProtectedRoute roles={['admin']} />}>
        <Route path="/admin" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
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
          <Route path="institutes" element={<SuperAdminInstitutes />} />
          <Route path="billing" element={<SuperAdminBilling />} />
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
  );
}

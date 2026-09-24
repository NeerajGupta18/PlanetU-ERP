import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ROLE_HOME } from './config/menu.config.js';
import AppShell from './components/layout/AppShell.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import { FullPageLoader } from './components/ui/Feedback.jsx';
import Login from './pages/Login.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import NotFound from './pages/NotFound.jsx';
import StudentDashboard from './pages/student/Dashboard.jsx';
import StudentProfile from './pages/student/Profile.jsx';
import StudentInstitute from './pages/student/Institute.jsx';
import StudentCalendar from './pages/student/Calendar.jsx';
import StudentTimetable from './pages/student/Timetable.jsx';

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

// Roles whose modules arrive in later phases: same shell, placeholder dashboard.
const LATER_PHASE = [
  { path: 'admin', role: 'admin' },
  { path: 'super-admin', role: 'super_admin' },
  { path: 'employee', role: 'employee' },
];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      {/* Phase 1: Student portal */}
      <Route element={<ProtectedRoute roles={['student']} />}>
        <Route path="/student" element={<AppShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="institute" element={<StudentInstitute />} />
          <Route path="calendar" element={<StudentCalendar />} />
          <Route path="timetable" element={<StudentTimetable />} />
        </Route>
      </Route>

      {LATER_PHASE.map(({ path, role }) => (
        <Route key={path} element={<ProtectedRoute roles={[role]} />}>
          <Route path={`/${path}`} element={<AppShell />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<ComingSoon />} />
          </Route>
        </Route>
      ))}

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

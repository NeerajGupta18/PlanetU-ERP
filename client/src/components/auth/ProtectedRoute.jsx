import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_HOME } from '../../config/menu.config.js';
import { FullPageLoader } from '../ui/Feedback.jsx';

/** Wrap routes that only certain roles may open: <Route element={<ProtectedRoute roles={['student']} />}> */
export default function ProtectedRoute({ roles }) {
  const { user, tenant, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // Temporary password: the only place they may go is the change-password page
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  // Access paused for an unpaid subscription: the institute's admin may only use the Billing page
  if (tenant?.billingLocked && user.role === 'admin' && !['/admin/billing', '/change-password'].includes(location.pathname)) return <Navigate to="/admin/billing" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return <Outlet />;
}

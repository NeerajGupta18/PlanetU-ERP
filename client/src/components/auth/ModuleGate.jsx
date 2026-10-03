import { Navigate, Outlet } from 'react-router-dom';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_HOME } from '../../config/menu.config.js';

/** Sends the user home if they open a URL for a module their institute doesn't have. */
export default function ModuleGate({ module }) {
  const { user } = useAuth();
  const { hasModule } = useTenantConfig();
  return hasModule(module) ? <Outlet /> : <Navigate to={ROLE_HOME[user.role]} replace />;
}

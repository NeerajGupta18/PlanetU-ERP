import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABEL } from '../config/menu.config.js';
import { Card, PageBanner } from '../components/ui/Ui.jsx';

/** Landing page for roles whose modules are built in later phases. Login and the shell already work for them. */
export default function ComingSoon() {
  const { user } = useAuth();
  return (
    <>
      <PageBanner icon={LayoutDashboard} title="Dashboard" subtitle={`Signed in as ${ROLE_LABEL[user.role]}`} />
      <Card title={`Welcome, ${user.name}`}>
        <p className="muted">
          Your sign-in works and your role is enforced by the server. The {ROLE_LABEL[user.role]} modules are part of the next
          development phase, so this page is intentionally empty for now.
        </p>
      </Card>
    </>
  );
}

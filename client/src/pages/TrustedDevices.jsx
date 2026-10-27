import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, Smartphone } from 'lucide-react';
import { api } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { ROLE_HOME } from '../config/menu.config.js';
import { Badge, Card, FormError } from '../components/ui/Ui.jsx';
import DataTable from '../components/ui/DataTable.jsx';
import { fmtDate } from '../utils/dates.js';
import {
  accountKey, enableFingerprint, fingerprintPossible, fingerprintReady, forgetAccount, isSaved, setDeclined,
} from '../lib/fingerprint.js';

/**
 * "Fingerprint and phones": the phones that can sign in to this account with a fingerprint (Android app), with
 * Remove. In the app it also turns fingerprint on or off for this phone. The admin also sees every phone in the
 * institute and can remove any of them.
 */
export default function TrustedDevices() {
  const { user, tenant, institute } = useAuth();
  const mine = useFetch('/auth/devices');
  const all = useFetch(user.role === 'admin' ? '/auth/devices/all' : null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inApp = fingerprintPossible() && tenant;
  const key = tenant ? accountKey(tenant.code, user) : null;
  const [on, setOn] = useState(() => Boolean(key && isSaved(key)));

  const reload = () => { mine.reload(); all.reload?.(); };

  const remove = async (path) => {
    setError(null);
    try { await api.del(path); reload(); } catch (e) { setError(e); }
  };

  const turnOn = async () => {
    setError(null); setNote(''); setBusy(true);
    try {
      if (!(await fingerprintReady())) throw new Error('This phone has no fingerprint set up. Add one in the phone\'s Settings first.');
      await enableFingerprint(tenant.code, user, institute?.name);
      setOn(true); reload();
    } catch (e) {
      if (e.status === 403) {
        // Fingerprint can only be turned on soon after a password sign-in: offer it at the next one
        setDeclined(key, false);
        setNote('For your safety, fingerprint is turned on right after signing in with your password. Sign out, sign in with your password, and choose "Use fingerprint".');
      } else if (String(e?.code) !== '16') setError(e);
    } finally { setBusy(false); }
  };

  const turnOff = async () => {
    setBusy(true);
    await forgetAccount(key);
    setDeclined(key, true);
    setOn(false); setBusy(false); reload();
  };

  const used = (d) => (d.lastUsedAt ? fmtDate(d.lastUsedAt) : 'Not yet');
  const cols = [
    { key: 'label', label: 'Phone', render: (d) => <strong>{d.label}</strong> },
    { key: 'createdAt', label: 'Added', render: (d) => fmtDate(d.createdAt) },
    { key: 'lastUsedAt', label: 'Last used', render: used },
    { key: 'expiresAt', label: 'Asks for password again', render: (d) => fmtDate(d.expiresAt) },
  ];

  return (
    <div className="public-page" style={{ maxWidth: 820 }}>
      <header className="public-page__head"><span className="banner__icon"><Fingerprint size={22} /></span>
        <div><h1>Fingerprint and phones</h1>
          <p>In the Android app you can sign in with your fingerprint. Your password is never saved on the phone, and every phone asks for the password again after 30 days.</p></div></header>

      <FormError error={error} />

      {inApp && (
        <Card title="This phone" icon={Smartphone}>
          <p style={{ margin: '0 0 12px' }}>
            Fingerprint sign-in on this phone: {on ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}
          </p>
          {note && <p className="muted" role="status">{note}</p>}
          <div className="form-actions">
            {on ? <button type="button" className="btn btn--outline" onClick={turnOff} disabled={busy}>Turn off on this phone</button>
              : <button type="button" className="btn btn--primary" onClick={turnOn} disabled={busy}><Fingerprint size={16} /> Use fingerprint on this phone</button>}
          </div>
        </Card>
      )}

      <Card title="Your phones">
        <DataTable
          caption="Your phones" rows={mine.data?.devices}
          columns={[...cols, {
            key: 'actions', label: '', actions: true,
            render: (d) => <button type="button" className="btn btn--outline btn--sm" onClick={() => remove(`/auth/devices/${d.id}`)}>Remove</button>,
          }]}
          empty={{ title: 'No phones use fingerprint for this account', hint: 'In the Android app, sign in with your password and choose "Use fingerprint".' }}
        />
      </Card>

      {user.role === 'admin' && (
        <Card title="All phones in the institute">
          <DataTable
            caption="All phones in the institute" rows={all.data?.devices}
            columns={[{ key: 'userName', label: 'Account', render: (d) => <><strong>{d.userName}</strong><br /><small className="muted">{d.loginId}</small></> },
              ...cols, {
                key: 'actions', label: '', actions: true,
                render: (d) => <button type="button" className="btn btn--outline btn--sm" onClick={() => remove(`/auth/devices/all/${d.id}`)}>Remove</button>,
              }]}
            empty={{ title: 'No phones use fingerprint yet', hint: 'They appear here when someone turns on fingerprint in the Android app.' }}
          />
        </Card>
      )}

      <p style={{ marginTop: 16 }}><Link to={ROLE_HOME[user.role]}>Back to home</Link></p>
    </div>
  );
}

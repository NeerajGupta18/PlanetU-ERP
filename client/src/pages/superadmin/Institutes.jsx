import { useState } from 'react';
import { Copy, KeyRound, Plus, Server, Settings2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { PROCESSES } from '../../config/processes.js';

const stepLabel = (key) => PROCESSES.setup.steps.find((s) => s.key === key)?.label;
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
/** The 30/60/90-day check-in that is due this week, if any. */
const checkDue = (days) => [30, 60, 90].find((d) => days >= d && days < d + 7);

/** How far a client has got with its seven-step setup, and the step it is on. */
function SetupCell({ t }) {
  if (!t.setup) return <span className="muted">-</span>;
  const { done, total, current } = t.setup;
  const days = daysSince(t.createdAt);
  const due = checkDue(days);
  return (
    <div className="setup-cell">
      <div className="progress" role="progressbar" aria-label={`${t.name} setup`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><div className="progress__fill" style={{ width: `${(done / total) * 100}%` }} /></div>
      <small>{done === total ? <strong>Ready</strong> : <>{done} of {total} · next: {stepLabel(current)}</>}</small>
      <small className="muted">Day {days}{due ? <> · <Badge tone="amber">{due}-day check due</Badge></> : ''}</small>
    </div>
  );
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default function Institutes() {
  const { confirm, toast } = useDialogs();
  const list = useFetch('/super-admin/tenants');
  const presets = useFetch('/super-admin/presets');
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState(null);
  const [secret, setSecret] = useState(null); // one-time admin password to show

  const settingUp = (list.data?.tenants || []).filter((t) => !t.settings?.demo && t.setup && t.setup.done < t.setup.total).length;
  const typeLabel = (key) => presets.data?.types.find((t) => t.key === key)?.label || key;

  const toggleStatus = async (t) => {
    const next = t.status === 'active' ? 'suspended' : 'active';
    if (!(await confirm(next === 'suspended'
      ? `Suspend ${t.name}? Nobody at this institute will be able to sign in until you reactivate it.`
      : `Reactivate ${t.name}?`, { danger: next === 'suspended', confirmLabel: next === 'suspended' ? 'Suspend' : 'Reactivate' }))) return;
    try { await api.put(`/super-admin/tenants/${t.id}`, { status: next }); list.reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={Server} title="Institutes" subtitle="Onboard clients, choose their modules and manage their access"
        next={settingUp ? `${settingUp} institute${settingUp === 1 ? ' is' : 's are'} still setting up: help the one furthest behind` : undefined}
        actions={<button type="button" className="btn btn--primary" onClick={() => setCreate(true)} disabled={!presets.data}><Plus size={15} /> Add Institute</button>}
      />

      <Card title="All institutes" icon={Server}>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.tenants.length === 0 ? <EmptyState title="No institutes yet" hint="Add your first client to get started." /> : (
            <div className="table-wrap">
              <table className="table table--stack">
                <thead><tr><th>Institute</th><th>Type</th><th>Plan</th><th>Status</th><th>Setup</th><th>Employees</th><th>Students</th><th>Modules</th><th>Actions</th></tr></thead>
                <tbody>
                  {list.data.tenants.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong><div className="muted">code: {t.code}</div></td>
                      <td data-label="Type"><Badge tone="purple">{typeLabel(t.type)}</Badge></td>
                      <td data-label="Plan"><Badge tone={t.settings?.demo ? 'amber' : 'blue'}>{t.plan}</Badge></td>
                      <td data-label="Status"><Badge tone={t.status === 'active' ? 'green' : 'red'}>{t.status}</Badge></td>
                      <td data-label="Setup"><SetupCell t={t} /></td>
                      <td data-label="Employees">{t.employees}</td>
                      <td data-label="Students">{t.students}</td>
                      <td className="muted" data-label="Modules">{t.modules.length}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => setEdit(t)}><Settings2 size={13} /> Configure</button>
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => toggleStatus(t)}>
                            {t.status === 'active' ? 'Suspend' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>

      {presets.data && (
        <CreateModal
          open={create} presets={presets.data} onClose={() => setCreate(false)}
          onCreated={(res) => { setCreate(false); setSecret(res); list.reload(); }}
        />
      )}
      {presets.data && edit && (
        <EditModal
          key={edit.id} tenant={edit} catalog={presets.data.modules} plans={presets.data.plans}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }}
          onSecret={(s) => setSecret(s)}
        />
      )}
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}

/* ---------- module picker ---------- */
function ModulePicker({ catalog, value, onChange }) {
  const toggle = (key) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div className="module-chips">
      {catalog.map((m) => (
        <label key={m.key} className={`module-chip ${m.core ? 'is-locked' : ''}`}>
          <input type="checkbox" checked={m.core || value.includes(m.key)} disabled={m.core} onChange={() => toggle(m.key)} />
          <span>{m.label}</span>
          <small>{m.core ? 'always on' : m.implemented ? '' : 'coming soon'}</small>
        </label>
      ))}
    </div>
  );
}

/* ---------- create ---------- */
function CreateModal({ open, presets, onClose, onCreated }) {
  const blank = { name: '', code: '', type: 'college', plan: 'trial', adminName: '', adminEmail: '' };
  const [form, setForm] = useState(blank);
  const [codeTouched, setCodeTouched] = useState(false);
  const [modules, setModules] = useState(presets.types.find((t) => t.key === 'college').modules);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const preset = presets.types.find((t) => t.key === form.type);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onType = (e) => {
    const type = e.target.value;
    setForm((f) => ({ ...f, type }));
    setModules(presets.types.find((t) => t.key === type).modules); // each type starts from its own preset
  };
  const onName = (e) => {
    const name = e.target.value;
    setForm((f) => ({ ...f, name, code: codeTouched ? f.code : slug(name) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post('/super-admin/tenants', {
        code: form.code, name: form.name, type: form.type, plan: form.plan, modules,
        admin: { name: form.adminName, email: form.adminEmail },
      });
      setForm(blank); setCodeTouched(false);
      onCreated({ title: 'Institute created', code: res.tenant.code, ...res.admin });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Add institute" onClose={onClose} width={760}>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <div className="fields">
          <label className="form-field form-field--full">
            <span className="label">Institute name</span>
            <input className="input" value={form.name} onChange={onName} required placeholder="e.g. Horizon College of Technology" />
          </label>
          <label className="form-field">
            <span className="label">Institute code (used to sign in)</span>
            <input
              className="input" value={form.code} required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" title="3-40 characters: lowercase letters, numbers, hyphens"
              onChange={(e) => { setCodeTouched(true); setForm((f) => ({ ...f, code: e.target.value.toLowerCase() })); }}
            />
          </label>
          <label className="form-field">
            <span className="label">Type</span>
            <select className="input" value={form.type} onChange={onType}>
              {presets.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span className="label">First admin - name</span>
            <input className="input" value={form.adminName} onChange={set('adminName')} required />
          </label>
          <label className="form-field">
            <span className="label">First admin - email</span>
            <input className="input" type="email" value={form.adminEmail} onChange={set('adminEmail')} required />
          </label>
          <label className="form-field">
            <span className="label">Plan</span>
            <select className="input" value={form.plan} onChange={set('plan')}>
              {presets.plans.filter((p) => p !== 'demo').map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <p className="muted" style={{ margin: '16px 0 8px' }}>
          A {preset.label.toLowerCase()} calls its people <strong>{preset.terminology.students}</strong> and <strong>{preset.terminology.employees}</strong>,
          and its courses <strong>{preset.terminology.courses}</strong>. Choose the modules included in this plan:
        </p>
        <ModulePicker catalog={presets.modules} value={modules} onChange={setModules} />

        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Creating...' : 'Create institute'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- configure ---------- */
function EditModal({ tenant, catalog, plans, onClose, onSaved, onSecret }) {
  const { confirm } = useDialogs();
  const [name, setName] = useState(tenant.name);
  const [plan, setPlan] = useState(tenant.plan);
  const [modules, setModules] = useState(tenant.modules);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.put(`/super-admin/tenants/${tenant.id}`, { name, plan, modules }); onSaved(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!(await confirm('Issue a new one-time password for this institute\'s admin? The old password stops working immediately.', { danger: true, confirmLabel: 'Issue new password' }))) return;
    try {
      const res = await api.post(`/super-admin/tenants/${tenant.id}/reset-admin-password`);
      onSecret({ title: 'New admin password', code: tenant.code, ...res.admin });
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal open title={`Configure - ${tenant.name}`} onClose={onClose} width={760}>
      <form onSubmit={save}>
        {error && <p className="form-error">{error}</p>}
        <div className="fields">
          <label className="form-field">
            <span className="label">Institute name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="form-field">
            <span className="label">Plan</span>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: '16px 0 8px' }}>Modules included in this institute's plan. Changes apply immediately, even to people already signed in.</p>
        <ModulePicker catalog={catalog} value={modules} onChange={setModules} />
        <div className="form-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn btn--outline" onClick={reset}><KeyRound size={14} /> Reset admin password</button>
          <span style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- one-time credentials ---------- */
function SecretModal({ secret, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!secret) return null;
  const text = `Institute code: ${secret.code}\nAdmin ID: ${secret.loginId}\nPassword: ${secret.temporaryPassword}`;
  return (
    <Modal open title={secret.title} onClose={onClose} width={480}>
      <div className="secret-box">
        <div>Institute code: <strong>{secret.code}</strong></div>
        <div>Admin ID: <strong>{secret.loginId}</strong> ({secret.email})</div>
        <div>One-time password:<br /><code>{secret.temporaryPassword}</code></div>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>This password is shown only once and is not stored. Share it securely with the institute's admin.</p>
      <div className="form-actions">
        <button
          type="button" className="btn btn--outline"
          onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); }}
        >
          <Copy size={14} /> {copied ? 'Copied' : 'Copy details'}
        </button>
        <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

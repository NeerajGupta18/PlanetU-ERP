import { useState } from 'react';
import { DoorOpen, LogIn, LogOut, Plus, Printer, Search, X } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { Badge, Card, PageBanner, StatCard, Tabs, pending } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate, todayISO } from '../../utils/dates.js';
import { fmtDateTime } from '../../utils/learning.js';

const STATUS = { expected: { label: 'Expected', tone: 'blue' }, checked_in: { label: 'Inside', tone: 'green' }, checked_out: { label: 'Left', tone: 'gray' }, cancelled: { label: 'Cancelled', tone: 'red' } };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function printPass(v) {
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) return;
  w.document.write(`<!doctype html><title>Visitor pass ${esc(v.passNo)}</title><style>body{font-family:system-ui,sans-serif;margin:24px;text-align:center}
    .card{border:2px solid #3f2bc9;border-radius:14px;padding:20px}h1{margin:0;font-size:14px;letter-spacing:3px;color:#3f2bc9}h2{margin:12px 0 4px;font-size:26px}
    .no{font-size:30px;font-weight:700;letter-spacing:2px;margin:8px 0}p{margin:4px 0;color:#333}small{color:#666}</style>
    <div class="card"><h1>VISITOR</h1><h2>${esc(v.visitorName)}</h2><div class="no">${esc(v.passNo)}</div>
    <p>${esc(v.purpose)}${v.hostName ? ` · to meet ${esc(v.hostName)}` : v.hostNote ? ` · to meet ${esc(v.hostNote)}` : ''}</p>
    <p>${v.checkInAt ? `In: ${esc(new Date(v.checkInAt).toLocaleString('en-IN'))}` : ''}</p><small>Please return this pass at the gate when you leave.</small></div>
    <script>window.onload=function(){window.print()}</script>`);
  w.document.close();
}

/** The gate log. `role` is 'admin' (full gate desk) or 'employee' (visitors I am expecting). */
export default function Visitors({ role }) {
  const admin = role === 'admin';
  const [tab, setTab] = useTabParam(admin ? 'gate' : 'mine');
  const [adding, setAdding] = useState(null);
  const summary = useFetch(admin ? '/admin/visitors/summary' : null);
  const [tick, setTick] = useState(0);
  const refresh = () => { setTick((t) => t + 1); summary.reload(); };
  const s = summary.data;
  return (
    <>
      <PageBanner icon={DoorOpen} title="Visitors" subtitle={admin ? 'Who is on campus, who is expected, and a log of everyone who came.' : 'Visitors you are expecting. Register them so the gate lets them in quickly.'}
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding({})}><Plus size={14} /> {admin ? 'Add visitor' : 'Expect a visitor'}</button>} />
      {admin && s && (
        <div className="stats">
          <StatCard value={s.inCampus} label="Inside now" icon={DoorOpen} />
          <StatCard value={s.expectedToday} label="Expected today" icon={DoorOpen} />
          <StatCard value={s.arrivedToday} label="Arrived today" icon={DoorOpen} />
          <StatCard value={s.overstaying} label="Inside over 8 hours" icon={DoorOpen} {...pending(s.overstaying, { act: 'Check on them', clear: 'None' })} />
        </div>
      )}
      <Card>
        {admin && <Tabs tabs={[{ id: 'gate', label: 'At the gate' }, { id: 'log', label: 'Visitor log' }]} active={tab} onChange={setTab} />}
        <Table role={role} scope={admin && tab === 'gate' ? 'open' : ''} searchable={!admin || tab === 'log'} tick={tick} onChanged={refresh} />
      </Card>
      {adding && <Register role={role} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); refresh(); }} />}
    </>
  );
}

function Table({ role, scope, searchable, tick, onChanged }) {
  const admin = role === 'admin';
  const { confirm, toast } = useDialogs();
  const [search, setSearch] = useState(''); const [date, setDate] = useState('');
  const qs = new URLSearchParams({ ...(scope ? { scope } : {}), ...(search ? { search } : {}), ...(date ? { date } : {}), t: String(tick) }).toString();
  const { data, loading, error, reload } = useFetch(`/${role}/visitors?${qs}`);
  const act = async (v, verb, body) => { try { await api.post(`/${role}/visitors/${v.id}/${verb}`, body); onChanged(); reload(); } catch (err) { toast.error(err); } };
  const cancel = async (v) => { if (await confirm(`Cancel the visit of ${v.visitorName}?`, { title: 'Cancel visit', confirmLabel: 'Cancel visit', danger: true })) act(v, 'cancel'); };
  return (
    <>
      {searchable && (
        <div className="toolbar"><div className="toolbar__filters">
          <div className="input-wrap"><Search size={14} /><input className="input input--icon" placeholder="Name, company, phone or pass" aria-label="Search visitors" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <input type="date" className="input" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} />
        </div></div>
      )}
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.visits.length === 0 ? <EmptyState title={scope ? 'Nobody is inside or expected' : 'No visitors found'} /> : (
          <div className="table-wrap"><table className="table table--stack">
            <thead><tr><th>Visitor</th><th>Meeting</th><th>Purpose</th><th>Time</th><th>Status</th><th /></tr></thead>
            <tbody>{data.visits.map((v) => (
              <tr key={v.id}>
                <td><strong>{v.visitorName}</strong> <small className="muted">{v.passNo}</small><br /><small className="muted">{[v.organisation, v.phone, v.people > 1 && `${v.people} people`, v.vehicleNo].filter(Boolean).join(' · ') || '-'}</small></td>
                <td data-label="Meeting">{v.hostName || v.hostNote || <span className="muted">-</span>}</td>
                <td data-label="Purpose">{v.purpose}</td>
                <td data-label="Time"><small>{v.checkInAt ? <>In {fmtDateTime(v.checkInAt)}{v.checkOutAt && <><br />Out {fmtDateTime(v.checkOutAt)}</>}</> : v.expectedOn ? `Expected ${fmtDate(String(v.expectedOn).slice(0, 10))}` : '-'}</small></td>
                <td><Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>{v.overstay && <> <Badge tone="amber">Long stay</Badge></>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {admin && v.status === 'expected' && <button type="button" className="btn btn--primary btn--sm" onClick={() => act(v, 'check-in', {})}><LogIn size={13} /> Check in</button>}
                  {admin && v.status === 'checked_in' && <button type="button" className="btn btn--primary btn--sm" onClick={() => act(v, 'check-out')}><LogOut size={13} /> Check out</button>}
                  {admin && ['checked_in', 'checked_out'].includes(v.status) && <button type="button" className="icon-btn" aria-label={`Print pass for ${v.visitorName}`} onClick={() => printPass(v)}><Printer size={15} /></button>}
                  {v.status === 'expected' && <button type="button" className="icon-btn" aria-label={`Cancel visit of ${v.visitorName}`} onClick={() => cancel(v)}><X size={15} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </DataBoundary>
    </>
  );
}

function Register({ role, onClose, onSaved }) {
  const admin = role === 'admin';
  const { toast } = useDialogs();
  const meta = useFetch(`/${role}/visitors/meta`);
  const [f, setF] = useState({ visitorName: '', phone: '', email: '', organisation: '', purpose: 'Meeting', hostId: '', hostNote: '', people: 1, vehicleNo: '', idShown: '', expectedOn: todayISO(), notes: '', checkIn: admin });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post(`/${role}/visitors`, { ...f, people: Number(f.people) });
      toast.success(`${r.visit.visitorName} registered. Pass ${r.visit.passNo}.`);
      if (admin && r.visit.status === 'checked_in') printPass(r.visit);
      onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={admin ? 'Add visitor' : 'Expect a visitor'} onClose={onClose} width={620}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field"><label className="label" htmlFor="v-name">Visitor name *</label><input id="v-name" className="input" value={f.visitorName} maxLength={120} onChange={set('visitorName')} required autoFocus /></div>
          <div className="form-field"><label className="label" htmlFor="v-phone">Phone</label><input id="v-phone" className="input" value={f.phone} maxLength={30} onChange={set('phone')} /></div>
          <div className="form-field"><label className="label" htmlFor="v-org">Company or organisation</label><input id="v-org" className="input" value={f.organisation} maxLength={120} onChange={set('organisation')} /></div>
          <div className="form-field"><label className="label" htmlFor="v-email">Email</label><input id="v-email" type="email" className="input" value={f.email} maxLength={120} onChange={set('email')} /></div>
          <div className="form-field"><label className="label" htmlFor="v-purpose">Purpose *</label>
            <select id="v-purpose" className="input" value={f.purpose} onChange={set('purpose')}>{(meta.data?.purposes || [f.purpose]).map((p) => <option key={p}>{p}</option>)}</select></div>
          {admin ? (
            <div className="form-field"><label className="label" htmlFor="v-host">Meeting (staff member)</label>
              <select id="v-host" className="input" value={f.hostId} onChange={set('hostId')}><option value="">Not listed</option>{(meta.data?.hosts || []).map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}</select></div>
          ) : <div className="form-field"><label className="label" htmlFor="v-date">Visit date</label><input id="v-date" type="date" className="input" min={todayISO()} value={f.expectedOn} onChange={set('expectedOn')} /></div>}
          {admin && !f.hostId && <div className="form-field form-field--full"><label className="label" htmlFor="v-note">Or whom / which department</label><input id="v-note" className="input" value={f.hostNote} maxLength={120} onChange={set('hostNote')} /></div>}
          <div className="form-field"><label className="label" htmlFor="v-people">People</label><input id="v-people" type="number" min="1" max="50" className="input" value={f.people} onChange={set('people')} /></div>
          <div className="form-field"><label className="label" htmlFor="v-veh">Vehicle number</label><input id="v-veh" className="input" value={f.vehicleNo} maxLength={20} onChange={set('vehicleNo')} /></div>
          {admin && <div className="form-field"><label className="label" htmlFor="v-id">ID shown</label>
            <select id="v-id" className="input" value={f.idShown} onChange={set('idShown')}><option value="">None</option>{(meta.data?.idTypes || []).map((t) => <option key={t}>{t}</option>)}</select></div>}
          <div className="form-field form-field--full"><label className="label" htmlFor="v-notes">Notes</label><input id="v-notes" className="input" value={f.notes} maxLength={500} onChange={set('notes')} /></div>
          {admin && <div className="form-field form-field--full"><label><input type="checkbox" checked={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.checked })} /> Arrived now: check in and print the pass</label>
            {!f.checkIn && <div className="form-field" style={{ marginTop: 8 }}><label className="label" htmlFor="v-exp">Expected on</label><input id="v-exp" type="date" className="input" min={todayISO()} value={f.expectedOn} onChange={set('expectedOn')} style={{ maxWidth: 200 }} /></div>}</div>}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Please do not record ID numbers. Note only which ID was shown.</p>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{admin && f.checkIn ? 'Check in' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

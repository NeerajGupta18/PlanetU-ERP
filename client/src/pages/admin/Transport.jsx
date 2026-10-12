import { useState } from 'react';
import { ArrowDown, ArrowUp, Bus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import StudentPicker from '../../components/campus/StudentPicker.jsx';
import { inr0 } from '../../utils/billing.js';
import { fmtDate, fmtTime, todayISO } from '../../utils/dates.js';

const TABS = [{ id: 'riders', label: 'Riders' }, { id: 'routes', label: 'Routes' }];

function RouteEditor({ route, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [f, setF] = useState({ name: route.name || '', vehicleNo: route.vehicleNo || '', driverName: route.driverName || '', driverPhone: route.driverPhone || '', seats: route.seats || 40, monthlyFee: route.monthlyFee ?? '', active: route.active !== false });
  const [stops, setStops] = useState(route.stops?.length ? route.stops.map((s) => ({ ...s })) : [{ name: '', pickupTime: '' }]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setStop = (i, k, v) => setStops((l) => l.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const move = (i, d) => setStops((l) => { const n = [...l]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = { ...f, stops: stops.filter((s) => s.name.trim()).map((s) => ({ id: s.id, name: s.name, pickupTime: s.pickupTime })) };
    try {
      if (route.id) await api.put(`/admin/transport/${route.id}`, body); else await api.post('/admin/transport', body);
      onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={route.id ? 'Edit route' : 'Add route'} onClose={onClose} width={640}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="t-name">Route name *</label><input id="t-name" className="input" value={f.name} maxLength={80} onChange={set('name')} required autoFocus /></div>
          <div className="form-field"><label className="label" htmlFor="t-veh">Vehicle number</label><input id="t-veh" className="input" value={f.vehicleNo} onChange={set('vehicleNo')} /></div>
          <div className="form-field"><label className="label" htmlFor="t-seats">Seats</label><input id="t-seats" className="input" type="number" min="1" max="200" value={f.seats} onChange={set('seats')} /></div>
          <div className="form-field"><label className="label" htmlFor="t-drv">Driver</label><input id="t-drv" className="input" value={f.driverName} onChange={set('driverName')} /></div>
          <div className="form-field"><label className="label" htmlFor="t-phone">Driver phone</label><input id="t-phone" className="input" value={f.driverPhone} onChange={set('driverPhone')} /></div>
          <div className="form-field"><label className="label" htmlFor="t-fee">Monthly charge</label><input id="t-fee" className="input" type="number" min="0" step="0.01" value={f.monthlyFee} onChange={set('monthlyFee')} /></div>
          <div className="form-field" style={{ alignSelf: 'end' }}><label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Running</label></div>
        </div>
        <label className="label" style={{ marginTop: 10 }}>Stops, in the order the bus reaches them</label>
        {stops.map((s, i) => (
          <div className="stop-row" key={s.id || i}>
            <input className="input" placeholder={`Stop ${i + 1}`} aria-label={`Stop ${i + 1} name`} value={s.name} maxLength={80} onChange={(e) => setStop(i, 'name', e.target.value)} />
            <input className="input" type="time" aria-label={`Stop ${i + 1} pickup time`} value={s.pickupTime} onChange={(e) => setStop(i, 'pickupTime', e.target.value)} />
            <span className="row-actions">
              <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
              <button type="button" className="icon-btn" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              <button type="button" className="icon-btn" aria-label="Remove stop" onClick={() => setStops((l) => l.filter((_, j) => j !== i))}><X size={14} /></button>
            </span>
          </div>
        ))}
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setStops((l) => [...l, { name: '', pickupTime: '' }])}><Plus size={13} /> Add stop</button>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function Routes() {
  const { confirm, toast } = useDialogs();
  const list = useFetch('/admin/transport');
  const [editing, setEditing] = useState(null);
  const remove = async (r) => {
    if (!(await confirm(`Delete "${r.name}"?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/transport/${r.id}`); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card title="Routes" action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing({})}><Plus size={14} /> Add route</button>}>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.routes.length === 0 ? <EmptyState title="No routes yet" hint="Add a route with its stops, then put students on it." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Route</th><th>Vehicle and driver</th><th>Stops</th><th>Seats filled</th><th>Charge / month</th><th /></tr></thead>
              <tbody>
                {list.data.routes.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong> {!r.active && <Badge tone="gray">Not running</Badge>}</td>
                    <td>{r.vehicleNo || '-'}<div className="muted">{[r.driverName, r.driverPhone].filter(Boolean).join(' - ')}</div></td>
                    <td className="muted">{r.stops.map((s) => `${s.name}${s.pickupTime ? ` (${fmtTime(s.pickupTime)})` : ''}`).join(' > ') || '-'}</td>
                    <td><span className="occupancy">{r.riders} / {r.seats}</span><div className="bar"><span style={{ width: `${Math.min(100, (r.riders / r.seats) * 100)}%` }} /></div></td>
                    <td>{inr0(r.monthlyFee)}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil size={13} /></button>
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {editing && <RouteEditor route={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </Card>
  );
}

function StopChooser({ stopId, setStopId }) {
  const routes = useFetch('/admin/transport');
  const running = (routes.data?.routes || []).filter((r) => r.active && r.stops.length);
  return (
    <div className="form-field"><label className="label" htmlFor="sc">Route and stop *</label>
      <select id="sc" className="input" value={stopId} onChange={(e) => setStopId(e.target.value)}>
        <option value="">Select...</option>
        {running.map((r) => (
          <optgroup key={r.id} label={`${r.name} (${r.seats - r.riders} seats free)`}>
            {r.stops.map((s) => <option key={s.id} value={s.id}>{s.name}{s.pickupTime ? ` - ${fmtTime(s.pickupTime)}` : ''}</option>)}
          </optgroup>
        ))}
      </select></div>
  );
}

function AssignModal({ ride, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [student, setStudent] = useState(null);
  const [stopId, setStopId] = useState('');
  const [fromDate, setFromDate] = useState(todayISO());
  const save = async (e) => {
    e.preventDefault();
    try {
      if (ride) await api.put(`/admin/transport/rides/${ride.id}/change`, { stopId });
      else await api.post('/admin/transport/rides', { studentId: student.id, stopId, fromDate });
      onSaved();
    } catch (err) { toast.error(err); }
  };
  return (
    <Modal open title={ride ? `Change stop for ${ride.name}` : 'Put a student on a route'} onClose={onClose} width={460}>
      <form onSubmit={save}>
        {ride ? <p className="muted" style={{ marginTop: 0 }}>Now on {ride.route}, stop {ride.stop}.</p> : <StudentPicker value={student} onPick={setStudent} />}
        {(ride || student) && <StopChooser stopId={stopId} setStopId={setStopId} />}
        {!ride && <div className="form-field"><label className="label" htmlFor="as-d">Riding from</label><input id="as-d" className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>}
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={!stopId || (!ride && !student)}>{ride ? 'Change' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}

function Riders() {
  const { confirm, toast } = useDialogs();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [assigning, setAssigning] = useState(null); // false/undefined = closed, {} = new, ride = change
  const list = useFetch(`/admin/transport/rides?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const end = async (r) => {
    if (!(await confirm(`Take ${r.name} off ${r.route}?`, { confirmLabel: 'End ride', danger: true }))) return;
    try { await api.put(`/admin/transport/rides/${r.id}/end`, {}); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card title="Riders" action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setAssigning({})}><Plus size={14} /> Add a rider</button>}>
      <div className="toolbar">
        <div className="toolbar__filters"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Riding now</option><option value="ended">Stopped</option></select></div>
        <div className="input-wrap" style={{ minWidth: 220 }}><Search size={14} /><input className="input input--icon" placeholder="Name or ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.rides.length === 0 ? <EmptyState title="Nobody here" hint={status === 'active' ? 'No student is on a route yet.' : 'No ended rides.'} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Student</th><th>Route</th><th>Stop</th><th>From</th>{status === 'ended' && <th>Until</th>}<th /></tr></thead>
              <tbody>
                {list.data.rides.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong><div className="muted">{r.studentCode}{r.course ? ` - ${r.course}` : ''}</div></td>
                    <td>{r.route}<div className="muted">{r.vehicleNo}</div></td>
                    <td>{r.stop}{r.pickupTime && <div className="muted">{fmtTime(r.pickupTime)}</div>}</td>
                    <td>{fmtDate(r.from)}</td>{status === 'ended' && <td>{fmtDate(r.to)}</td>}
                    <td className="row-actions">{r.status === 'active' && (<>
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setAssigning(r)}>Change stop</button>
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => end(r)}>End</button>
                    </>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {assigning && <AssignModal ride={assigning.id ? assigning : null} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); list.reload(); }} />}
    </Card>
  );
}

export default function Transport() {
  const [tab, setTab] = useTabParam('riders', TABS.map((t) => t.id));
  return (
    <>
      <PageBanner icon={Bus} title="Transport" subtitle="Bus routes, stops and who rides" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'riders' ? <Riders /> : <Routes />}
    </>
  );
}

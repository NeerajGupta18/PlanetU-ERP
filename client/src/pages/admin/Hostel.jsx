import { useState } from 'react';
import { BedDouble, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import StudentPicker from '../../components/campus/StudentPicker.jsx';
import { inr0 } from '../../utils/billing.js';
import { fmtDate, todayISO } from '../../utils/dates.js';

const KIND = { boys: 'Boys', girls: 'Girls', mixed: 'Mixed' };
const TABS = [{ id: 'residents', label: 'Residents' }, { id: 'hostels', label: 'Hostels and rooms' }];

function HostelEditor({ hostel, onClose, onSaved }) {
  const { toast } = useDialogs();
  const emps = useFetch('/admin/employees');
  const [f, setF] = useState({ name: hostel.name || '', kind: hostel.kind || 'mixed', wardenId: hostel.wardenId || '', phone: hostel.phone || '', notes: hostel.notes || '', active: hostel.active !== false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (hostel.id) await api.put(`/admin/hostel/${hostel.id}`, f); else await api.post('/admin/hostel', f);
      onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={hostel.id ? 'Edit hostel' : 'Add hostel'} onClose={onClose} width={480}>
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="h-name">Name *</label><input id="h-name" className="input" value={f.name} maxLength={80} onChange={set('name')} required autoFocus /></div>
          <div className="form-field"><label className="label" htmlFor="h-kind">For</label>
            <select id="h-kind" className="input" value={f.kind} onChange={set('kind')}><option value="boys">Boys</option><option value="girls">Girls</option><option value="mixed">Mixed</option></select></div>
          <div className="form-field"><label className="label" htmlFor="h-phone">Phone</label><input id="h-phone" className="input" value={f.phone} maxLength={30} onChange={set('phone')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="h-warden">Warden</label>
            <select id="h-warden" className="input" value={f.wardenId} onChange={set('wardenId')}><option value="">None</option>{emps.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="h-notes">Notes</label><input id="h-notes" className="input" value={f.notes} maxLength={500} onChange={set('notes')} /></div>
          <div className="form-field form-field--full"><label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use</label></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function RoomsModal({ hostel, onClose, onChanged }) {
  const { confirm, toast } = useDialogs();
  const list = useFetch(`/admin/hostel/${hostel.id}/rooms`);
  const [f, setF] = useState({ roomNos: '', beds: 2, floor: 0, monthlyFee: '' });
  const [edit, setEdit] = useState(null);
  const done = () => { list.reload(); onChanged(); };
  const add = async (e) => {
    e.preventDefault();
    try { const r = await api.post(`/admin/hostel/${hostel.id}/rooms`, f); toast.success(`${r.created} room${r.created === 1 ? '' : 's'} added.`); setF({ ...f, roomNos: '' }); done(); } catch (err) { toast.error(err); }
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    try { await api.put(`/admin/hostel/rooms/${edit.id}`, edit); setEdit(null); done(); } catch (err) { toast.error(err); }
  };
  const remove = async (r) => {
    if (!(await confirm(`Delete room ${r.roomNo}?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/hostel/rooms/${r.id}`); done(); } catch (err) { toast.error(err); }
  };
  return (
    <Modal open title={`${hostel.name} - rooms`} onClose={onClose} width={760}>
      <form onSubmit={add} className="fields fields--3" style={{ marginBottom: 14 }}>
        <div className="form-field"><label className="label" htmlFor="r-nos">Room numbers *</label><input id="r-nos" className="input" placeholder="101-110, 201" value={f.roomNos} onChange={(e) => setF({ ...f, roomNos: e.target.value })} required /></div>
        <div className="form-field"><label className="label" htmlFor="r-beds">Beds each</label><input id="r-beds" className="input" type="number" min="1" max="20" value={f.beds} onChange={(e) => setF({ ...f, beds: e.target.value })} /></div>
        <div className="form-field"><label className="label" htmlFor="r-floor">Floor</label><input id="r-floor" className="input" type="number" min="0" max="50" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} /></div>
        <div className="form-field"><label className="label" htmlFor="r-fee">Monthly charge</label><input id="r-fee" className="input" type="number" min="0" step="0.01" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} /></div>
        <div className="form-field" style={{ alignSelf: 'end' }}><button className="btn btn--primary"><Plus size={14} /> Add rooms</button></div>
      </form>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.rooms.length === 0 ? <EmptyState title="No rooms yet" hint="Add rooms above, for example 101-110." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Room</th><th>Floor</th><th>Beds</th><th>Charge / month</th><th>Staying</th><th /></tr></thead>
              <tbody>
                {list.data.rooms.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.roomNo}</strong> {!r.active && <Badge tone="gray">Unavailable</Badge>}</td>
                    <td>{r.floor}</td>
                    <td>{r.occupied} / {r.beds}</td>
                    <td>{inr0(r.monthlyFee)}</td>
                    <td className="muted">{r.occupants.map((o) => o.name).join(', ') || '-'}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`Edit room ${r.roomNo}`} onClick={() => setEdit({ ...r })}><Pencil size={13} /></button>
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`Delete room ${r.roomNo}`} onClick={() => remove(r)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {edit && (
        <Modal open title={`Room ${edit.roomNo}`} onClose={() => setEdit(null)} width={420}>
          <form onSubmit={saveEdit}>
            <div className="fields">
              <div className="form-field"><label className="label" htmlFor="e-no">Room number</label><input id="e-no" className="input" value={edit.roomNo} onChange={(e) => setEdit({ ...edit, roomNo: e.target.value })} required /></div>
              <div className="form-field"><label className="label" htmlFor="e-floor">Floor</label><input id="e-floor" className="input" type="number" min="0" value={edit.floor} onChange={(e) => setEdit({ ...edit, floor: e.target.value })} /></div>
              <div className="form-field"><label className="label" htmlFor="e-beds">Beds</label><input id="e-beds" className="input" type="number" min="1" max="20" value={edit.beds} onChange={(e) => setEdit({ ...edit, beds: e.target.value })} /></div>
              <div className="form-field"><label className="label" htmlFor="e-fee">Monthly charge</label><input id="e-fee" className="input" type="number" min="0" step="0.01" value={edit.monthlyFee} onChange={(e) => setEdit({ ...edit, monthlyFee: e.target.value })} /></div>
              <div className="form-field form-field--full"><label><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Available</label></div>
            </div>
            <div className="form-actions"><button type="button" className="btn btn--outline" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn--primary">Save</button></div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}

function Hostels() {
  const { confirm, toast } = useDialogs();
  const list = useFetch('/admin/hostel');
  const [editing, setEditing] = useState(null);
  const [rooms, setRooms] = useState(null);
  const remove = async (h) => {
    if (!(await confirm(`Delete "${h.name}"?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/hostel/${h.id}`); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card title="Hostels" action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing({})}><Plus size={14} /> Add hostel</button>}>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.hostels.length === 0 ? <EmptyState title="No hostels yet" hint="Add a hostel, then add its rooms." action={{ label: 'Add a hostel', onClick: () => setEditing({}) }} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Hostel</th><th>For</th><th>Warden</th><th>Rooms</th><th>Beds filled</th><th /></tr></thead>
              <tbody>
                {list.data.hostels.map((h) => (
                  <tr key={h.id}>
                    <td><strong>{h.name}</strong> {!h.active && <Badge tone="gray">Not in use</Badge>}{h.phone && <div className="muted">{h.phone}</div>}</td>
                    <td>{KIND[h.kind]}</td>
                    <td>{h.warden || '-'}</td>
                    <td>{h.rooms}</td>
                    <td><span className="occupancy">{h.occupied} / {h.beds}</span><div className="bar"><span style={{ width: `${h.beds ? Math.min(100, (h.occupied / h.beds) * 100) : 0}%` }} /></div></td>
                    <td className="row-actions">
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setRooms(h)}>Rooms</button>
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}><Pencil size={13} /></button>
                      <button type="button" className="btn btn--outline btn--sm" aria-label={`Delete ${h.name}`} onClick={() => remove(h)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {editing && <HostelEditor hostel={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {rooms && <RoomsModal hostel={rooms} onClose={() => setRooms(null)} onChanged={list.reload} />}
    </Card>
  );
}

/** Pick a hostel and a room with a free bed. */
function RoomChooser({ student, roomId, setRoomId }) {
  const hostels = useFetch('/admin/hostel');
  const [hostelId, setHostelId] = useState('');
  const rooms = useFetch(hostelId ? `/admin/hostel/${hostelId}/rooms` : null);
  const g = String(student?.gender || '').toLowerCase();
  const usable = (hostels.data?.hostels || []).filter((h) => h.active && (h.kind === 'mixed' || !g || (h.kind === 'boys' ? g.startsWith('m') : g.startsWith('f'))));
  const free = (rooms.data?.rooms || []).filter((r) => r.active && r.occupied < r.beds);
  return (
    <>
      <div className="form-field"><label className="label" htmlFor="rc-h">Hostel *</label>
        <select id="rc-h" className="input" value={hostelId} onChange={(e) => { setHostelId(e.target.value); setRoomId(''); }}>
          <option value="">Select...</option>{usable.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.beds - h.occupied} beds free)</option>)}</select></div>
      <div className="form-field"><label className="label" htmlFor="rc-r">Room *</label>
        <select id="rc-r" className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!hostelId}>
          <option value="">{hostelId && free.length === 0 && rooms.data ? 'No room has a free bed' : 'Select...'}</option>
          {free.map((r) => <option key={r.id} value={r.id}>Room {r.roomNo} - {r.beds - r.occupied} free - {inr0(r.monthlyFee)}/month</option>)}</select></div>
    </>
  );
}

function AllotModal({ onClose, onSaved }) {
  const { toast } = useDialogs();
  const [student, setStudent] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [fromDate, setFromDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post('/admin/hostel/stays', { studentId: student.id, roomId, fromDate }); toast.success('Room allotted.'); onSaved(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Allot a room" onClose={onClose} width={480}>
      <form onSubmit={save}>
        <StudentPicker value={student} onPick={setStudent} />
        {student && <RoomChooser student={student} roomId={roomId} setRoomId={setRoomId} />}
        <div className="form-field"><label className="label" htmlFor="al-d">Staying from</label><input id="al-d" className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={!student || !roomId || busy}>Allot</button></div>
      </form>
    </Modal>
  );
}

function MoveModal({ stay, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [roomId, setRoomId] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { await api.put(`/admin/hostel/stays/${stay.id}/transfer`, { roomId }); onSaved(); } catch (err) { toast.error(err); }
  };
  return (
    <Modal open title={`Move ${stay.name}`} onClose={onClose} width={440}>
      <form onSubmit={save}>
        <p className="muted" style={{ marginTop: 0 }}>Now in {stay.hostel}, room {stay.roomNo}.</p>
        <RoomChooser student={{ gender: stay.kind === 'boys' ? 'male' : stay.kind === 'girls' ? 'female' : '' }} roomId={roomId} setRoomId={setRoomId} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={!roomId}>Move</button></div>
      </form>
    </Modal>
  );
}

function Residents() {
  const { confirm, toast } = useDialogs();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [allot, setAllot] = useState(false);
  const [moving, setMoving] = useState(null);
  const list = useFetch(`/admin/hostel/stays?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const vacate = async (s) => {
    if (!(await confirm(`${s.name} leaves room ${s.roomNo}?`, { confirmLabel: 'Vacate', danger: true }))) return;
    try { await api.put(`/admin/hostel/stays/${s.id}/vacate`, {}); list.reload(); } catch (err) { toast.error(err); }
  };
  return (
    <Card title="Residents" action={<button type="button" className="btn btn--primary btn--sm" onClick={() => setAllot(true)}><Plus size={14} /> Allot a room</button>}>
      <div className="toolbar">
        <div className="toolbar__filters"><select aria-label="Show residents" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Staying now</option><option value="vacated">Moved out</option></select></div>
        <div className="input-wrap" style={{ minWidth: 220 }}><Search size={14} /><input className="input input--icon" placeholder="Name, ID or room" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <DataBoundary loading={list.loading && !list.data} error={list.error} data={list.data} reload={list.reload}>
        {list.data && (list.data.stays.length === 0 ? <EmptyState title="Nobody here" hint={status === 'active' ? 'No student has been allotted a room yet.' : 'No one has moved out.'} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Student</th><th>Hostel</th><th>Room</th><th>From</th>{status === 'vacated' && <th>Until</th>}<th /></tr></thead>
              <tbody>
                {list.data.stays.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="muted">{s.studentCode}{s.course ? ` - ${s.course}` : ''}</div></td>
                    <td>{s.hostel}</td><td>{s.roomNo}</td><td>{fmtDate(s.from)}</td>{status === 'vacated' && <td>{fmtDate(s.to)}</td>}
                    <td className="row-actions">{s.status === 'active' && (<>
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => setMoving(s)}>Move</button>
                      <button type="button" className="btn btn--outline btn--sm" onClick={() => vacate(s)}>Vacate</button>
                    </>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {allot && <AllotModal onClose={() => setAllot(false)} onSaved={() => { setAllot(false); list.reload(); }} />}
      {moving && <MoveModal stay={moving} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); list.reload(); }} />}
    </Card>
  );
}

export default function Hostel() {
  const [tab, setTab] = useTabParam('residents', TABS.map((t) => t.id));
  return (
    <>
      <PageBanner icon={BedDouble} title="Hostel" subtitle="Hostels, rooms and who stays where" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'residents' ? <Residents /> : <Hostels />}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api/http.js';

/** Search active students by name, ID or email and pick one. Calls onPick(student) or onPick(null). */
export default function StudentPicker({ value, onPick, label = 'Student' }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState([]);

  useEffect(() => {
    if (value || text.trim().length < 2) { setFound([]); return undefined; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api.get(`/admin/students?status=Active&search=${encodeURIComponent(text.trim())}`, { signal: ctrl.signal })
        .then((r) => setFound(r.students.slice(0, 6))).catch(() => {});
    }, 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text, value]);

  if (value) {
    return (
      <div className="form-field"><label className="label">{label} *</label>
        <div className="picked"><strong>{value.name}</strong> <span className="muted">{value.studentCode}{value.course ? ` - ${value.course}` : ''}</span>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => { onPick(null); setText(''); }}>Change</button></div>
      </div>
    );
  }
  return (
    <div className="form-field"><label className="label" htmlFor="sp-search">{label} *</label>
      <div className="input-wrap"><Search size={14} /><input id="sp-search" className="input input--icon" placeholder="Type a name or ID" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" /></div>
      {found.length > 0 && (
        <ul className="pick-list">
          {found.map((s) => (
            <li key={s.id}><button type="button" onClick={() => onPick(s)}><strong>{s.name}</strong> <span className="muted">{s.studentCode} - {s.course}</span></button></li>
          ))}
        </ul>
      )}
      {text.trim().length >= 2 && found.length === 0 && <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>No active student matches.</p>}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, FileText, Search, UserRound, Users } from 'lucide-react';
import { api } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Ctrl+K (or Cmd+K) quick search: jump to any page in the menu, and - for admins - find a
 * student or employee by name. Arrow keys move, Enter opens, Esc closes.
 */
export default function SearchPalette({ open, onClose, flat }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [people, setPeople] = useState([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const isAdmin = user.role === 'admin';
  const q = text.trim().toLowerCase();

  useEffect(() => { if (open) { setText(''); setPeople([]); setCursor(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  // People search runs after a short pause in typing
  useEffect(() => {
    if (!open || !isAdmin || q.length < 2) { setPeople([]); return undefined; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const enc = encodeURIComponent(text.trim());
      const [s, e] = await Promise.all([
        api.get(`/admin/students?search=${enc}`, { signal: ctrl.signal }).catch(() => ({ students: [] })),
        api.get(`/admin/employees?search=${enc}`, { signal: ctrl.signal }).catch(() => ({ employees: [] })),
      ]);
      if (ctrl.signal.aborted) return;
      setPeople([
        ...(s.students || []).slice(0, 5).map((x) => ({ key: `s${x.id}`, kind: 'student', text: x.name, sub: `${x.studentCode} - ${x.course || ''}`, to: `/admin/students?search=${encodeURIComponent(x.studentCode)}` })),
        ...(e.employees || []).slice(0, 5).map((x) => ({ key: `e${x.id}`, kind: 'employee', text: x.name, sub: `${x.designation || ''} - ${x.department || ''}`, to: `/admin/employees?search=${encodeURIComponent(x.name)}` })),
      ]);
    }, 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text, q, open, isAdmin]);

  const results = useMemo(() => {
    const pages = flat
      .filter((i) => !q || `${i.text} ${i.parent || ''} ${i.group || ''}`.toLowerCase().includes(q))
      .slice(0, q ? 8 : 12)
      .map((i) => ({ key: i.to, kind: 'page', text: i.text, sub: [i.group, i.parent].filter(Boolean).join(' > ') || 'Main', to: i.to, icon: i.icon }));
    return [...pages, ...people];
  }, [flat, q, people]);

  useEffect(() => { setCursor(0); }, [q]);
  if (!open) return null;

  const go = (r) => { onClose(); navigate(r.to); };
  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && results[cursor]) go(results[cursor]);
  };
  const KIND_ICON = { page: FileText, student: UserRound, employee: Users };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="Quick search" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette__input">
          <Search size={18} />
          <input
            ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={isAdmin ? 'Search pages, students or employees...' : 'Search pages...'} aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette__list">
          {results.length === 0 && <li className="palette__empty">Nothing found for "{text}".</li>}
          {results.map((r, idx) => {
            const Icon = r.icon || KIND_ICON[r.kind];
            return (
              <li key={r.key}>
                <button type="button" className={`palette__item ${idx === cursor ? 'is-active' : ''}`} onMouseEnter={() => setCursor(idx)} onClick={() => go(r)}>
                  <Icon size={16} />
                  <span className="palette__text"><strong>{r.text}</strong><small>{r.sub}</small></span>
                  <span className="palette__kind">{r.kind === 'page' ? 'Page' : r.kind === 'student' ? 'Student' : 'Employee'}</span>
                  {idx === cursor && <CornerDownLeft size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

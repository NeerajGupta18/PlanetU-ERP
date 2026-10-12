import { useState } from 'react';
import { Download } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import Modal from '../ui/Modal.jsx';
import { Badge } from '../ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../ui/Feedback.jsx';
import { STATUS } from './status.js';

/** Applicants ranked within each course. Download as CSV (Excel) or PDF to put on a notice board. */
export default function MeritListModal({ onClose, courseLabel = 'Course' }) {
  const [courseId, setCourseId] = useState('');
  const courses = useFetch('/admin/courses');
  const qs = courseId ? `courseId=${courseId}` : '';
  const list = useFetch(`/admin/admissions/merit-list?${qs}`);
  const rows = list.data?.rows || [];
  return (
    <Modal open title="Merit list" onClose={onClose} width={820}>
      <div className="toolbar">
        <select className="input" style={{ maxWidth: 260 }} value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label={courseLabel}>
          <option value="">All {courseLabel.toLowerCase()}s</option>
          {(courses.data?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="row-actions">
          <a className="btn btn--outline btn--sm" href={`/api/admin/admissions/merit-list?${qs}${qs ? '&' : ''}format=csv`}><Download size={13} /> Excel (CSV)</a>
          <a className="btn btn--outline btn--sm" href={`/api/admin/admissions/merit-list?${qs}${qs ? '&' : ''}format=pdf`}><Download size={13} /> PDF</a>
        </div>
      </div>
      <p className="muted" style={{ margin: '4px 0 10px' }}>Ranked by the qualifying percentage, or the merit score you set on an application. Rejected and draft applications are left out.</p>
      <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
        {rows.length === 0 ? <EmptyState title="No applications to rank yet" /> : (
          <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>Rank</th><th>Applicant</th><th>{courseLabel}</th><th>Merit</th><th>Category</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.applicationNo}>
                    <td><strong>{r.rank}</strong></td>
                    <td>{r.name}<div className="muted">{r.applicationNo}</div></td>
                    <td>{r.course}</td>
                    <td>{r.merit ?? '-'}</td>
                    <td>{r.category || '-'}</td>
                    <td><Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataBoundary>
    </Modal>
  );
}

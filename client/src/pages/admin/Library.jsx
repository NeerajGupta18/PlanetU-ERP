import { useState } from 'react';
import { BookOpen, Plus, Search, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function Library() {
  const [tab, setTab] = useState('catalogue');
  const [newBook, setNewBook] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const books = useFetch(tab === 'catalogue' ? '/admin/library/books' : null);
  const issues = useFetch(tab === 'issues' ? '/admin/library/issues?status=active' : null);

  return (
    <>
      <PageBanner
        icon={BookOpen} title="Library" subtitle="Catalogue, issue and return books"
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => setIssuing(true)}><Plus size={13} /> Issue a book</button>}
      />
      <Card>
        <Tabs tabs={[{ id: 'catalogue', label: 'Catalogue' }, { id: 'issues', label: 'On loan' }]} active={tab} onChange={setTab} />
        {tab === 'catalogue' && (
          <>
            <div className="toolbar"><span /><button type="button" className="btn btn--outline btn--sm" onClick={() => setNewBook(true)}><Plus size={13} /> Add book</button></div>
            <DataBoundary loading={books.loading} error={books.error} data={books.data} reload={books.reload}>
              {books.data && (books.data.books.length === 0 ? <EmptyState title="No books yet" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Title</th><th>Author</th><th>ISBN</th><th>Copies</th><th /></tr></thead>
                    <tbody>
                      {books.data.books.map((b) => <BookRow key={b.id} b={b} onChanged={books.reload} />)}
                    </tbody>
                  </table>
                </div>
              ))}
            </DataBoundary>
          </>
        )}
        {tab === 'issues' && (
          <DataBoundary loading={issues.loading} error={issues.error} data={issues.data} reload={issues.reload}>
            {issues.data && (issues.data.issues.length === 0 ? <EmptyState title="Nothing on loan" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Book</th><th>Borrower</th><th>Issued</th><th>Due</th><th /></tr></thead>
                  <tbody>
                    {issues.data.issues.map((i) => (
                      <tr key={i.id}>
                        <td>{i.bookTitle}</td>
                        <td>{i.studentName || i.employeeName} <span className="muted">({i.studentCode || i.employeeCode})</span></td>
                        <td className="muted">{fmtDate(i.issuedAt.slice(0, 10))}</td>
                        <td><Badge tone={new Date(i.dueDate) < new Date() ? 'red' : 'blue'}>{fmtDate(i.dueDate)}</Badge></td>
                        <td><ReturnButton issue={i} onDone={issues.reload} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </DataBoundary>
        )}
      </Card>
      {newBook && <BookModal onClose={() => setNewBook(false)} onDone={() => { setNewBook(false); books.reload(); }} />}
      {issuing && <IssueModal onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); issues.reload(); books.reload(); }} />}
    </>
  );
}

function BookRow({ b, onChanged }) {
  const remove = async () => {
    if (!confirm(`Delete "${b.title}"?`)) return;
    try { await api.del(`/admin/library/books/${b.id}`); onChanged(); } catch (e) { alert(e.message); }
  };
  return (
    <tr>
      <td><strong>{b.title}</strong>{b.category && <div className="muted">{b.category}</div>}</td>
      <td>{b.author || '-'}</td><td className="muted">{b.isbn || '-'}</td>
      <td><Badge tone={b.availableCopies > 0 ? 'green' : 'red'}>{b.availableCopies} / {b.totalCopies}</Badge></td>
      <td><button type="button" className="btn btn--outline btn--sm" onClick={remove}><Trash2 size={13} /></button></td>
    </tr>
  );
}

function ReturnButton({ issue, onDone }) {
  const [busy, setBusy] = useState(false);
  const doReturn = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/admin/library/issues/${issue.id}/return`);
      if (Number(r.issue.fineAmount) > 0) alert(`Returned. Late fine: ${inr(r.issue.fineAmount)}.`);
      onDone();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  return <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={doReturn}>Return</button>;
}

function BookModal({ onClose, onDone }) {
  const [form, setForm] = useState({ title: '', author: '', isbn: '', publisher: '', category: '', shelfLocation: '', totalCopies: 1 });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/admin/library/books', { ...form, totalCopies: Number(form.totalCopies) }); onDone(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <Modal open title="Add a book" onClose={onClose} width={480}>
      <form onSubmit={submit}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="bk-title">Title</label><input id="bk-title" className="input" required value={form.title} onChange={set('title')} /></div>
          <div className="form-field"><label className="label" htmlFor="bk-author">Author</label><input id="bk-author" className="input" value={form.author} onChange={set('author')} /></div>
          <div className="form-field"><label className="label" htmlFor="bk-isbn">ISBN</label><input id="bk-isbn" className="input" value={form.isbn} onChange={set('isbn')} /></div>
          <div className="form-field"><label className="label" htmlFor="bk-category">Category</label><input id="bk-category" className="input" value={form.category} onChange={set('category')} /></div>
          <div className="form-field"><label className="label" htmlFor="bk-shelf">Shelf location</label><input id="bk-shelf" className="input" value={form.shelfLocation} onChange={set('shelfLocation')} /></div>
          <div className="form-field"><label className="label" htmlFor="bk-copies">Copies</label><input id="bk-copies" className="input" type="number" min="0" value={form.totalCopies} onChange={set('totalCopies')} /></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary">Add book</button></div>
      </form>
    </Modal>
  );
}

function IssueModal({ onClose, onDone }) {
  const [bookQuery, setBookQuery] = useState('');
  const [book, setBook] = useState(null);
  const [borrowerType, setBorrowerType] = useState('student');
  const [borrowerQuery, setBorrowerQuery] = useState('');
  const [borrower, setBorrower] = useState(null);
  const [err, setErr] = useState('');
  const books = useFetch(bookQuery.length > 1 ? `/admin/library/books?search=${encodeURIComponent(bookQuery)}` : null);
  const students = useFetch(borrowerType === 'student' && borrowerQuery.length > 1 ? `/admin/students?search=${encodeURIComponent(borrowerQuery)}` : null);
  const employees = useFetch(borrowerType === 'employee' && borrowerQuery.length > 1 ? `/admin/employees?search=${encodeURIComponent(borrowerQuery)}` : null);
  const borrowerResults = borrowerType === 'student' ? students.data?.students : employees.data?.employees;

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/admin/library/issues', { bookId: book.id, borrowerType, borrowerId: borrower.id }); onDone(); } catch (e2) { setErr(e2.message); }
  };

  return (
    <Modal open title="Issue a book" onClose={onClose} width={480}>
      <form onSubmit={submit}>
        {err && <p className="form-error">{err}</p>}
        <div className="form-field"><label className="label">Book</label>
          {book ? <div className="badge badge--blue">{book.title} <button type="button" onClick={() => setBook(null)} style={{ marginLeft: 6 }}>×</button></div> : (
            <>
              <div className="input-wrap"><Search size={14} /><input className="input input--icon" placeholder="Search title or ISBN" value={bookQuery} onChange={(e) => setBookQuery(e.target.value)} /></div>
              {books.data?.books?.length > 0 && (
                <ul className="picklist">{books.data.books.filter((b) => b.availableCopies > 0).map((b) => (
                  <li key={b.id}><button type="button" className="btn btn--outline btn--sm" onClick={() => setBook(b)}>{b.title}</button></li>
                ))}</ul>
              )}
            </>
          )}
        </div>
        <div className="form-field" style={{ marginTop: 10 }}><label className="label">Borrower type</label>
          <select className="input" value={borrowerType} onChange={(e) => { setBorrowerType(e.target.value); setBorrower(null); }}>
            <option value="student">Student</option><option value="employee">Employee</option>
          </select>
        </div>
        <div className="form-field" style={{ marginTop: 10 }}><label className="label">Borrower</label>
          {borrower ? <div className="badge badge--blue">{borrower.name} <button type="button" onClick={() => setBorrower(null)} style={{ marginLeft: 6 }}>×</button></div> : (
            <>
              <div className="input-wrap"><Search size={14} /><input className="input input--icon" placeholder="Search by name" value={borrowerQuery} onChange={(e) => setBorrowerQuery(e.target.value)} /></div>
              {borrowerResults?.length > 0 && (
                <ul className="picklist">{borrowerResults.map((p) => (
                  <li key={p.id}><button type="button" className="btn btn--outline btn--sm" onClick={() => setBorrower(p)}>{p.name}</button></li>
                ))}</ul>
              )}
            </>
          )}
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={!book || !borrower}>Issue</button></div>
      </form>
    </Modal>
  );
}

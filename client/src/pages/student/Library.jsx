import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';

export default function Library() {
  const [tab, setTab] = useState('mine');
  const [search, setSearch] = useState('');
  const mine = useFetch(tab === 'mine' ? '/student/library/my-issues' : null);
  const catalogue = useFetch(tab === 'catalogue' ? `/student/library/books${search ? `?search=${encodeURIComponent(search)}` : ''}` : null);

  return (
    <>
      <PageBanner icon={BookOpen} title="Library" subtitle="Your issued books and the catalogue" />
      <Card>
        <Tabs tabs={[{ id: 'mine', label: 'My books' }, { id: 'catalogue', label: 'Catalogue' }]} active={tab} onChange={setTab} />
        {tab === 'mine' && (
          <DataBoundary loading={mine.loading} error={mine.error} data={mine.data} reload={mine.reload}>
            {mine.data && (mine.data.issues.length === 0 ? <EmptyState title="No books on loan" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Book</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead>
                  <tbody>
                    {mine.data.issues.map((i) => (
                      <tr key={i.id}>
                        <td>{i.bookTitle}</td><td className="muted">{fmtDate(i.issuedAt.slice(0, 10))}</td>
                        <td>{fmtDate(i.dueDate)}</td>
                        <td>{i.returnedAt ? <Badge tone="gray">Returned{Number(i.fineAmount) > 0 ? ` - fine ₹${i.fineAmount}${i.finePaid ? ' (paid)' : ''}` : ''}</Badge>
                          : <Badge tone={new Date(i.dueDate) < new Date() ? 'red' : 'blue'}>On loan</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </DataBoundary>
        )}
        {tab === 'catalogue' && (
          <div>
            <div className="input-wrap" style={{ maxWidth: 340, margin: '12px 0' }}><Search size={14} /><input className="input input--icon" placeholder="Search by title, author or ISBN" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <DataBoundary loading={catalogue.loading} error={catalogue.error} data={catalogue.data} reload={catalogue.reload}>
              {catalogue.data && (catalogue.data.books.length === 0 ? <EmptyState title="No books found" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Available</th></tr></thead>
                    <tbody>
                      {catalogue.data.books.map((b) => (
                        <tr key={b.id}><td>{b.title}</td><td>{b.author || '-'}</td><td>{b.category || '-'}</td>
                          <td><Badge tone={b.availableCopies > 0 ? 'green' : 'red'}>{b.availableCopies} / {b.totalCopies}</Badge></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </DataBoundary>
          </div>
        )}
      </Card>
    </>
  );
}

import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { addDays, toISO } from '../utils/dates.js';

const LOAN_DAYS = 14;
const FINE_PER_DAY = 5;
const MAX_ACTIVE_LOANS = 3;

const BOOK_SELECT = `
  select id, isbn, title, author, publisher, category, shelf_location as "shelfLocation",
         total_copies as "totalCopies", available_copies as "availableCopies"
  from books`;

export async function listBooks({ search, category } = {}) {
  const where = []; const params = [];
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(title) like $${params.length} or lower(author) like $${params.length} or lower(isbn) like $${params.length})`); }
  if (category) { params.push(category); where.push(`category = $${params.length}`); }
  const { rows } = await q(`${BOOK_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by title`, params);
  return rows;
}

export async function getBook(id) {
  const { rows: [b] } = await q(`${BOOK_SELECT} where id = $1`, [id]);
  if (!b) throw new HttpError(404, 'Book not found.');
  return b;
}

export async function createBook(body) {
  const { title, author, isbn, publisher, category, shelfLocation, totalCopies } = body || {};
  if (!title?.trim()) throw new HttpError(400, 'Title is required.');
  const copies = Number.isInteger(totalCopies) && totalCopies >= 0 ? totalCopies : 1;
  const { rows: [b] } = await q(
    `insert into books (title, author, isbn, publisher, category, shelf_location, total_copies, available_copies)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
    [title.trim(), (author || '').trim(), (isbn || '').trim(), (publisher || '').trim(), (category || '').trim(), (shelfLocation || '').trim(), copies],
  );
  return getBook(b.id);
}

export async function updateBook(id, body) {
  const cur = await getBook(id);
  const { title, author, isbn, publisher, category, shelfLocation, totalCopies } = body || {};
  if (totalCopies !== undefined) {
    if (!Number.isInteger(totalCopies) || totalCopies < 0) throw new HttpError(400, 'Total copies must be a whole number.');
    const onLoan = cur.totalCopies - cur.availableCopies;
    if (totalCopies < onLoan) throw new HttpError(400, `Cannot reduce total copies below ${onLoan} - that many are currently on loan.`);
  }
  const newTotal = totalCopies ?? cur.totalCopies;
  const newAvailable = cur.availableCopies + (newTotal - cur.totalCopies);
  await q(
    `update books set title = $1, author = $2, isbn = $3, publisher = $4, category = $5, shelf_location = $6,
       total_copies = $7, available_copies = $8 where id = $9`,
    [title?.trim() || cur.title, author ?? cur.author, isbn ?? cur.isbn, publisher ?? cur.publisher, category ?? cur.category,
      shelfLocation ?? cur.shelfLocation, newTotal, newAvailable, id],
  );
  return getBook(id);
}

export async function deleteBook(id) {
  const { rows: [{ n }] } = await q('select count(*)::int as n from book_issues where book_id = $1 and returned_at is null', [id]);
  if (n) throw new HttpError(409, 'This book has copies currently on loan and cannot be deleted.');
  const { rowCount } = await q('delete from books where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Book not found.');
}

const ISSUE_SELECT = `
  select i.id, i.book_id as "bookId", b.title as "bookTitle", i.borrower_type as "borrowerType",
         i.student_id as "studentId", s.name as "studentName", s.student_code as "studentCode",
         i.employee_id as "employeeId", e.name as "employeeName", e.emp_code as "employeeCode",
         i.issued_at as "issuedAt", i.due_date as "dueDate", i.returned_at as "returnedAt",
         i.fine_amount as "fineAmount", i.fine_paid as "finePaid"
  from book_issues i
  join books b on b.id = i.book_id
  left join students s on s.id = i.student_id
  left join employees e on e.id = i.employee_id`;

export async function listIssues({ status, borrowerId, borrowerType } = {}) {
  const where = []; const params = [];
  if (status === 'active') where.push('i.returned_at is null');
  if (status === 'overdue') where.push(`i.returned_at is null and i.due_date < current_date`);
  if (status === 'returned') where.push('i.returned_at is not null');
  if (borrowerId && borrowerType === 'student') { params.push(borrowerId); where.push(`i.student_id = $${params.length}`); }
  if (borrowerId && borrowerType === 'employee') { params.push(borrowerId); where.push(`i.employee_id = $${params.length}`); }
  const { rows } = await q(`${ISSUE_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by i.issued_at desc`, params);
  return rows;
}

export async function issueBook(body, admin) {
  const { bookId, borrowerType, borrowerId } = body || {};
  if (!['student', 'employee'].includes(borrowerType)) throw new HttpError(400, 'Borrower type must be student or employee.');
  const table = borrowerType === 'student' ? 'students' : 'employees';
  const { rowCount: borrowerOk } = await q(`select 1 from ${table} where id = $1`, [borrowerId]);
  if (!borrowerOk) throw new HttpError(404, `${borrowerType === 'student' ? 'Student' : 'Employee'} not found.`);

  const { rows: [book] } = await q('select available_copies from books where id = $1 for update', [bookId]);
  if (!book) throw new HttpError(404, 'Book not found.');
  if (book.available_copies <= 0) throw new HttpError(409, 'No copies of this book are currently available.');

  const col = borrowerType === 'student' ? 'student_id' : 'employee_id';
  const { rows: [{ n }] } = await q(`select count(*)::int as n from book_issues where ${col} = $1 and returned_at is null`, [borrowerId]);
  if (n >= MAX_ACTIVE_LOANS) throw new HttpError(409, `This ${borrowerType} already has ${MAX_ACTIVE_LOANS} books on loan - the maximum allowed.`);

  const dueDate = toISO(addDays(new Date(), LOAN_DAYS));
  const { rows: [issue] } = await q(
    `insert into book_issues (book_id, borrower_type, ${col}, due_date, issued_by) values ($1, $2, $3, $4, $5) returning id`,
    [bookId, borrowerType, borrowerId, dueDate, admin.id],
  );
  await q('update books set available_copies = available_copies - 1 where id = $1', [bookId]);
  await audit(admin, 'library.issue', 'book', bookId, { borrowerType, borrowerId, dueDate });
  const { rows: [full] } = await q(`${ISSUE_SELECT} where i.id = $1`, [issue.id]);
  return full;
}

export async function returnBook(issueId, admin) {
  const { rows: [issue] } = await q('select book_id, due_date, returned_at from book_issues where id = $1 for update', [issueId]);
  if (!issue) throw new HttpError(404, 'Issue record not found.');
  if (issue.returned_at) throw new HttpError(409, 'This book was already returned.');

  const today = toISO(new Date());
  const overdueDays = Math.max(0, Math.round((new Date(today) - new Date(issue.due_date)) / 86400000));
  const fine = overdueDays * FINE_PER_DAY;
  await q('update book_issues set returned_at = now(), fine_amount = $1 where id = $2', [fine, issueId]);
  await q('update books set available_copies = available_copies + 1 where id = $1', [issue.book_id]);
  await audit(admin, 'library.return', 'book', issue.book_id, { issueId, overdueDays, fine });
  const { rows: [full] } = await q(`${ISSUE_SELECT} where i.id = $1`, [issueId]);
  return full;
}

export async function payFine(issueId, admin) {
  const { rows: [issue] } = await q('select fine_amount, fine_paid, returned_at from book_issues where id = $1', [issueId]);
  if (!issue) throw new HttpError(404, 'Issue record not found.');
  if (!issue.returned_at) throw new HttpError(409, 'This book has not been returned yet.');
  if (Number(issue.fine_amount) <= 0) throw new HttpError(400, 'There is no fine on this record.');
  if (issue.fine_paid) throw new HttpError(409, 'This fine has already been paid.');
  await q('update book_issues set fine_paid = true where id = $1', [issueId]);
  await audit(admin, 'library.fine_paid', 'book_issue', issueId, { amount: issue.fine_amount });
  const { rows: [full] } = await q(`${ISSUE_SELECT} where i.id = $1`, [issueId]);
  return full;
}

export const myIssues = (studentId) => listIssues({ borrowerId: studentId, borrowerType: 'student' });

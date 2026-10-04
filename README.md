<p align="center">
  <img src="client/public/logo-full.png" width="360" alt="PlanetU Technovision" />
</p>

<h1 align="center">🎓 PlanetU Technovision — Campus ERP</h1>
<p align="center"><em>Elevate your Ideas — a multi-tenant ERP for schools, colleges and universities: students, employees, institute admins and the platform vendor.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18.11%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-16%20%2B%20RLS-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Auth-JWT%20%2B%20bcrypt-EC1C24?style=for-the-badge&logo=jsonwebtokens&logoColor=white" />
  <img src="https://img.shields.io/badge/Multi--tenant-SaaS-7C3AED?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Tests-417%20passing-2ea44f?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Deploy-Render%20%7C%20Oracle%20Cloud-46E3B7?style=for-the-badge" />
  <img src="https://img.shields.io/badge/STATUS-PHASE%207-2ea44f?style=for-the-badge" />
</p>

---

## 📌 Overview

A **multi-tenant Campus ERP** built from scratch in plain JavaScript — Node.js + Express + PostgreSQL on the
backend, React + Vite on the frontend. **One deployment serves many institutes**: each school, college or
university is a *tenant* with its own data, its own switched-on modules and its own vocabulary
("Class" vs "Course" vs "Programme", "Teacher" vs "Faculty"), all from one codebase. Tenant isolation is enforced
by PostgreSQL itself (Row Level Security), not just by application code.

Four roles share one shell and one login screen, each landing on their own module set:
**Super Admin** (the platform vendor), **Admin** (one institute's administrator), **Employee / Faculty** and
**Student** — plus public **Applicants** who apply without an account. Every login goes through an
"I'm not a robot" check (custom human-detection by default, or Google reCAPTCHA v2 the moment you drop in a
site/secret key pair — no code change either way).

**Phase 1** shipped the login + the 5 Student modules. **Phase 2** shipped the full Admin side (6 modules).
**Phases 3 to 7** moved the data layer from a JSON file to multi-tenant PostgreSQL, and added the institute
operations (admissions, fees, library, assets), academics (attendance, exams, reports), the vendor's own
subscription billing, and the learning platform with quizzes. See *What's built* below.

---

## ✅ What's built

| Phase | Role | Modules |
|-------|------|---------|
| 1 | 🎓 Student | Dashboard · Profile · Institute *(public info only)* · Calendar · Timetable |
| 2 | 🛠️ Admin | Admin Dashboard · Institute *(details, stakeholders, authorized persons, documents, bank accounts, stamp & e-sign)* · Departments & Designations · Employees · Calendar *(full month-grid view)* · Timetable / Lecture Reassignment |
| 3 | 👑 Super Admin *(vendor console)* | Platform Dashboard · Institutes *(onboard a client, pick its type and modules, suspend / activate, reset its admin's password)* · multi-tenant core on PostgreSQL with Row Level Security · accounts, password reset and an email outbox |
| 4 | 🛠️ Admin · 📝 Applicant · 🎓 Student | **Courses** *(classes / programmes: add, edit, delete only when unused)* · **Admissions** *(public form at `/apply/<institute-code>`, document review, enrolment)* · **Students** *(PRN, photo, status, bulk CSV import)* · **ID cards** *(print-ready PDF)* · **Fees & Payments** *(structures, instalments, PDF receipts, online payment via Razorpay)* · **Library** · **Assets** |
| 5 | 🛠️ Admin · 👔 Employee / Faculty · 🎓 Student | **Attendance** *(faculty mark per lecture; admin corrections; student percentages)* · **Exams & Results** *(papers, marks entry, grading scale, GPA, report-card PDFs)* · **Reports & Exports** *(Excel / PDF / CSV)* |
| 6 | 👑 Super Admin · 🛠️ Admin | **Vendor billing** — plans and trials, recurring GST tax invoices, Razorpay payment, reminders, access pause for non-payment, revenue and receivables |
| 7 | 🎓 Student · 👔 Faculty · 🛠️ Admin | **Learning platform** *(NPTEL / SWAYAM / in-house courses assigned for compulsory credits)* · **Quizzes** *(timed, auto-graded, scaled into internal marks)* · on-screen document viewer for admission review |
| — | 🚀 Deployment | Render *(Blueprint)* and Oracle Cloud guides · backups and restore · feature-by-feature Git history |

**Student vs. Admin data boundary:** a student only ever sees the institute's public profile
(name, tagline, address, contact). Stakeholders, authorized persons' PAN/Aadhaar, documents, bank
beneficiary details and the institute stamp/signature are Admin-only — stripped server-side from
the student API response, not just hidden in the UI, and the admin routes are behind
`requireRole('admin')` so a student session gets a `403` if it tries to reach them directly.

---

## 1. Quick start

Requirements: **Node.js 18.11+** (tested on 22 and 24), npm, and **PostgreSQL 15+** (tested on 16; Docker is the easiest way).

```bash
# 1. Start PostgreSQL - pick ONE:
docker compose up -d                       # (a) Docker
# --- or, on macOS with Homebrew ---
brew install postgresql@16 && brew services start postgresql@16          # (b) local install
psql postgres -c "create role erp_owner login superuser password 'erp_owner_dev'"
createdb -O erp_owner planetu_erp

# 2. Install, create the schema + demo institutes, and run
npm install
npm run db:setup     # migrations + 3 demo institutes (college, school, university) + the vendor account
npm run dev          # API on :5000, web app on :5173
```

Open **http://localhost:5173**. The defaults in `server/.env.example` match the commands above, so no
`.env` is needed for local development.

`npm run db:setup` is safe to re-run any time: it applies any new migrations and **re-creates the demo
institutes** (it never touches real, non-demo institutes). To keep your existing data and only add new
tables, run `npm run db:migrate` instead.

### Tests

```bash
npm test             # 417 tests against a real PostgreSQL (run db:setup first)
```

They cover tenant isolation, uploads, admissions, accounts and email, students and ID cards, fees, online payments
(Razorpay, mocked), library, assets, attendance, exams and results (including grading maths and report-card PDFs),
bulk import, reports, vendor billing and GST invoices, learning and quizzes (including the server-owned quiz clock
and the answer key never reaching students), migrations, file storage and the vendor bootstrap. The suite also
passes in Render mode (`DB_SINGLE_ROLE=true STORAGE_DRIVER=db`, one ordinary database login): 390 tests, one
intentionally skipped because it needs a separate database role.

---

## 2. Demo accounts

Sign in with an **institute code**, pick the role, then enter the ID and password. Passwords are
case-sensitive. The Super Admin needs no institute code.

| Institute code | Type | Admin | Student | Employee |
|----------------|------|-------|---------|----------|
| `demo-college` | College — *Horizon College of Technology* | `ADM001` | `STU2026001` | `EMP001` |
| `demo-school`  | School — *Greenfield Public School* | `ADM001` | `GPS2026001` | `EMP001` |
| `demo-university` | University — *MIT World Peace University, Pune* | `ADM001` | `MIT2026001` | `EMP001` |

| Role        | Password         |
|-------------|------------------|
| Super Admin *(no institute code)* — `SA001` | `SuperAdmin@123` |
| Admin       | `Admin@123`      |
| Student     | `Student@123`    |
| Employee    | `Employee@123`   |

Notice that `ADM001` exists in all three institutes but is a different person in each — the institute code
decides whose data you get. Each institute also speaks its own language: the university calls its courses
*Programmes*; the school has *Teachers* and *Classes*.

In development mode the login page has one-click "fill demo credentials" shortcuts. They are removed from
production builds. **These demo accounts and passwords are public — never run `db:setup` on a real server**
(it refuses to when `NODE_ENV=production`); create your own owner login with `npm run create-vendor`.

---

## 3. How sign-in and the "I'm not a robot" check work

Two providers exist side by side, decided automatically by the server:

**A. Custom built-in check (default, no setup needed)**
1. The checkbox component records real interaction (pointer/keyboard/touch/scroll), time on page,
   and contains a hidden honeypot field.
2. On click it calls `POST /api/auth/captcha/verify`. The server checks that the event was
   trusted, the honeypot is empty, enough time has passed, and there was enough interaction.
3. If it looks human, the server returns a **single-use, short-lived signed token**.
4. If it looks suspicious, the user gets a small maths challenge (3 attempts, 3-minute expiry).

**B. Google reCAPTCHA v2 ("I'm not a robot" checkbox widget)**
Turns on automatically the moment both `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY` are set
in `server/.env` — no code change needed. Get free keys at
[google.com/recaptcha/admin/create](https://www.google.com/recaptcha/admin/create)
(pick **reCAPTCHA v2 → "I'm not a robot" Checkbox**, add `localhost` as a domain for local testing).

```bash
# server/.env
RECAPTCHA_SITE_KEY=6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RECAPTCHA_SECRET_KEY=6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The login page asks the server which provider is active (`GET /api/auth/captcha/config`) and
renders the matching widget. The site key is safe to expose to the browser; the secret key
never leaves the server — it is only used server-side to call Google's
`siteverify` endpoint and check the widget's response was genuine.

Either provider ends the same way: a **single-use, short-lived signed token**, without which
`POST /api/auth/login` refuses to run. Swapping providers never touches the login controller —
it only calls `consumeCaptchaToken(token) -> boolean`.

Other login protections: bcrypt password hashing, httpOnly JWT session cookie (carrying the tenant),
generic "Incorrect institute code, ID, password or role" message, lockout after 5 failed attempts
per institute + ID (15 minutes; kept in memory, so move it to Redis before running several API instances),
rate limiting, Helmet security headers (including a Content-Security-Policy that allows
Google's reCAPTCHA script/iframe only — see `server/src/app.js`).

---

## 4. Feature guide

Each feature is its own module that the vendor can switch on or off per institute (*Institutes → Configure*).

### 📝 Admissions

Applicants apply **without creating an account**, through a link unique to each institute
(`/apply/demo-college`). The flow:

1. **Apply** — personal details, chosen course, guardian and previous education, behind the "I'm not a robot" check.
   The application starts as a private **draft**; the applicant receives an **application number** and a one-time
   **access code** (only its hash is stored). That pair is their key for everything that follows.
2. **Upload documents** — photo, ID proof and marksheet (PDF/PNG/JPEG ≤ 5 MB, verified by file contents, not extension) → **Submit**.
   Admins never see drafts.
3. **Review** — the admin verifies or rejects each document (a reason is required). A rejected document sends the
   application back; the applicant replaces it from the status page and resubmits.
4. **Decide** — accept (only once every required document is verified), waitlist or reject (a note is required and
   shown to the applicant).
5. **Enrol** — one click creates the student record with a **PRN** from the institute's own number series, a student
   login and a one-time password, atomically. Enrolling twice is refused.

Protections: per-IP rate limits on the public endpoints (`PUBLIC_RATE_LIMIT`, `PUBLIC_CREATE_LIMIT`,
`PUBLIC_LOOKUP_LIMIT`), captcha on application creation, the same row-level tenant isolation as everything else
(another institute's admin — or applicant code — gets a 404), and duplicate-application protection per email and course.
The module is `admissions`; switching it off for an institute closes its public form and the admin screen.

**Not built yet:** SMS, automatic purge of abandoned drafts, malware
scanning of uploads, and per-institute custom form fields / required-document lists.

### 🪪 Students & ID cards

Enrolling an applicant (see Admissions above) creates their student record automatically — no separate
"add student" step. The **Students** module lets an admin search, filter and edit that record (section,
semester, phone, blood group, status), and:

- **Photo** — carried over automatically from the applicant's verified admission photo, or uploaded/replaced
  by an admin (same magic-byte image validation as every other upload).
- **Status** — `Active` / `Inactive` / `Alumni`. Setting a student `Inactive` disables their login immediately
  without deleting their record or history; `Active` restores it.
- **ID card** — a two-sided, print-ready PDF (photo, name, PRN, course, section, batch; back has the
  institute's contact details) built server-side with PDFKit, so no headless browser is needed. Admins can
  print any student's card; each student can download only their own from their Profile page.

The module is `students` (record management) and `id_cards` (the PDF) — a vendor can offer one without
the other, e.g. student records without printable cards.

### 🔐 Accounts & email

| Feature | How it works |
|---------|--------------|
| **Email outbox** | Anything that sends mail (applications, decisions, password links) queues a row in the institute's own `notifications` table *inside the request's transaction*, so a mail exists only if the action succeeded. A worker delivers it over SMTP (`MAIL_TRANSPORT=smtp`, `SMTP_URL`); failures retry with growing delays and are marked failed after 5 attempts. The sender name is the institute's name. In development (`log`) mail is printed to the API console. |
| **Forgot password** | `/forgot-password`: institute code + email + captcha. The answer is identical whether or not the account exists. A single-use link (1 hour) is emailed; only the token's hash is stored, and a new request cancels the old link. |
| **Temporary passwords** | Generated passwords (new institute admin, vendor reset, enrolled student) are flagged *must change*. Until it is changed the account can do **nothing else** — the server answers `403 PASSWORD_CHANGE_REQUIRED` on every route except `/api/auth/*`, and the app sends them to the change-password screen. New accounts also get an emailed **setup link**, so the admin never has to relay a password. |
| **Change / reset = sign out everywhere** | Session tokens carry their exact mint time; a password change or reset invalidates every older session (other devices, a thief's stolen cookie) while keeping the device that made the change. |
| **Password rules** | 8–128 characters, at least one letter and one number, not equal to the login ID or email. |
| **Lost access code** | An applicant enters the email they applied with; fresh codes are emailed (the old ones stop working). Same generic answer for unknown emails; captcha + rate limit. |

Set `MAIL_TRANSPORT=smtp`, `SMTP_URL`, `MAIL_FROM_ADDRESS` (a domain you own, with SPF/DKIM) and `APP_URL` before real use.
The server prints a warning at start-up in production if mail is not configured.

### 💰 Fees & Payments, 📚 Library, 📦 Assets

Three more modules, following the same pattern as everything else: their own migration, service, admin
UI, and (where relevant) a student-facing view — each independently switchable per institute.

**Fees & Payments** (`fees`) — a fee **structure** is a per-course template ("BCA Year 1 2026-27":
Tuition ₹50,000, Exam ₹2,000...). Assigning it to a student **copies** its items as concrete charges,
so editing the template later never changes what an already-assigned student owes. Payments can be
split across several charges and a charge can be paid off across several payments (instalments); with
no explicit allocation, a payment is applied to the oldest dues first. Admins can also add one-off
manual charges and waive unpaid ones (with a reason). Every payment gets a real PDF receipt
(PDFKit), downloadable by the admin or by the paying student only.

**Library** (`library`) — a book catalogue with copy counts; issuing decrements availability and sets
a 14-day due date; returning computes a ₹5/day late fine automatically and can be marked paid.
Borrowers can be students or employees, capped at 3 active loans each. Students can search the
catalogue and see their own loans; only admins issue and return.

**Assets** (`assets`) — a register for institute property (classrooms, lab equipment, computers,
furniture...) with an auto-generated tag (`AST00001`...), status (`available` / `in_use` /
`maintenance` / `retired`), assignment to an employee, and a running history log (assignment changes,
status changes, logged maintenance with cost). Internal to the institute - no student-facing view.

### ✅ Attendance

Module key `attendance` (works together with `timetable`). A **lecture** is one dated occurrence of a weekly
timetable slot - the same `(slot, date)` pair the Timetable and Lecture Reassignment already use.

| Who | What |
|-----|------|
| **Faculty** | *Mark attendance* lists **today's** lectures from the Timetable. Open one, mark each student Present / Absent / Late (or *Mark all present* then flip the exceptions), **Save draft** or **Submit**. Submit needs every student marked. The teacher can correct a submitted sheet on the same day. |
| **Admin** | *Attendance → Daily sheet*: every lecture on any date, who teaches it, and whether it has been submitted. Open any past or present lecture to mark or correct it. *Reports*: per student and per subject, filter by course, dates and "below X%", **Export CSV**. |
| **Student** | *Attendance*: overall %, per-subject %, how many classes to attend to get back to the threshold (or how many can be missed), and the recent class log. The dashboard figures are the same. |

Rules enforced on the server: the person who may mark a lecture is the employee it is **reassigned to** for that date,
else the slot's own employee (the original teacher of a reassigned lecture gets a read-only view and the reason);
holidays and non-timetable dates have no lecture; future dates are refused; an employee can only mark **today**, only an
admin can fill or correct an earlier date; every change is in the audit log. Only **submitted** registers count in any
percentage, and **Late counts as attended**. The warning threshold is 75% (`DEFAULT_THRESHOLD` in
`services/attendance.service.js`). Until the first register is submitted for a student, the dashboard keeps showing the
old static figures stored on the student record; after that it shows only real marks.

Subject, course and times are copied onto each register, so deleting or editing a timetable slot never erases history.
"Today" is the **server's** local date - run the API with `TZ=Asia/Kolkata` (or your institute's zone) in production.

### 🎓 Exams & Results

Module key `exams`. Marks are the only thing stored; **percentage, grade and GPA are computed every time** from the marks
and the grading scale, so a corrected mark or an edited scale can never leave a stale result behind.

| Who | What |
|-----|------|
| **Admin** | *Exams & Results → New exam* (course, semester, type, dates). Tick *add a paper for every subject on the timetable* to start with one paper per subject, defaulted to its teacher, or add papers by hand (subject, max marks, pass marks, credits, who enters the marks). Watch each paper's progress, then **Publish**. The *Results* tab shows every student's marks, total, %, GPA and pass/fail, with class statistics, **Export CSV**, one report card per student, or **All report cards** as a single PDF. *Grading scale* edits the grade bands. |
| **Faculty** | *Exam marks* lists the papers assigned to them. The sheet is built for speed: type a mark, press **Enter** for the next student, tick **Absent** where needed. Marks are checked against the maximum as you type. **Save draft**, then **Submit marks** (every student needs a mark or Absent). They can keep correcting until the exam is published. |
| **Student** | *Results*: every published exam with marks, % and grade per subject, GPA, pass/fail, a **CGPA**, and a **Report card** PDF. Nothing is visible until the admin publishes. |

**Rules.** An exam can only be published once every paper's marks are submitted. After publishing, faculty are locked out; only an admin can correct a
mark (and every such correction is written to the audit log). Unpublishing hides it from students again. A published exam cannot be deleted or have papers added
or removed. A faculty member can only open papers assigned to them (anyone else's looks nonexistent). The students of an exam are the course's **active students
of that semester**, plus anyone who already has a mark in it, so history survives students moving up a semester.

**Grading.** Default is the common 10-point scale (O 90+ = 10, A+ 80+ = 9, A 70+ = 8, B+ 60+ = 7, B 50+ = 6, C 45+ = 5, P 40+ = 4, F = 0); each institute can replace it under
*Grading scale* (2-12 bands, lowest must start at 0%, higher bands cannot give fewer points). A paper below its **pass mark**, or an absence, is always the lowest grade with
0 points, whatever its percentage. **GPA** = sum(grade points x credits) / sum(credits) over every paper of the exam (a failed paper drags it down); credits earned = credits of papers passed.
If every subject counts equally, leave all credits at 1. The student's **CGPA** is the credit-weighted average over their published **Semester-end**-type exams only (unit tests and mid-terms
do not count); it does not model supplementary re-attempts.

**Report card.** An A4 PDF per student (institute letterhead, student details, subject table, total, percentage, GPA, credits earned, result, grading key, signature line using the
institute's signatory). An unpublished exam can be previewed by an admin and is stamped *PROVISIONAL*. Same pdfkit approach as the receipts and ID cards, so no new dependency.

**Demo data.** Each demo institute has last semester's *End-Semester Examination* already **published** (one student fails one paper, to show that path), and this semester's *Mid-Semester Examination*
as a **draft** with no marks, so faculty have papers waiting. Log in as `EMP001`, open *Exam marks*, and try it.

### 📥 Bulk student import (CSV)

*Students → Import from CSV.* For onboarding an institute's existing students without 500 individual applications.

1. **Download the template** (all columns, two example rows using one of your real course codes).
2. **Upload your file.** Only `name`, `email` and `course` (a course *code or name*) are required. Leave `student_id` empty to have IDs generated from the institute's PRN series, or fill it to **keep your existing numbers**. Headers are matched loosely (`Full Name`, `E-mail ID`, `Class`, `Mobile No`, `DOB`, `PRN`... all work); columns we don't use are listed and ignored.
3. **Review the preview.** Every row is checked *before anything is saved* and each problem is stated in plain words with its line number (bad email, unknown or ambiguous course, impossible date, phone mangled by Excel into `9.87E+11`, repeated or already-existing ID/email, ...).
4. **Import.** If any row has a problem, nothing is imported unless you tick *skip the rows with problems*. The whole import is one transaction: all accepted rows are created, or none. Download the **import report** (every row, imported or skipped, with its final student ID and the reason).

**Accounts.** *Create a login for each student* (default on) follows the same model as enrolment from Admissions: the login ID is the student ID and the account is flagged *must change password*. Instead of generating hundreds of temporary passwords, each login is created with a password nobody knows and the student is **emailed a single-use link to choose one (valid 7 days)**. Untick *email* to hold the emails back, in which case students use *Forgot password* when you are ready; untick *create logins* to import records only. Inactive/alumni students get a disabled login and no email.

**Formats it accepts.** CSV (comma, semicolon or tab), UTF-8 (with or without BOM) or Excel's plain Windows-1252 CSV, quoted values, embedded commas/newlines. An `.xlsx` is refused with instructions to *Save As > CSV UTF-8*. Dates: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY` (**day first**), `14-Mar-2005`; two-digit years are refused as ambiguous. Gender: `M/F/O` or full words. Blood group `A+`.. `O-`. Limits: 2,000 rows and 2 MB per file (500 students import in about 2 seconds).

**Safeguards.** Admin-only; every row is re-validated on the server at import time (the preview is never trusted); duplicates are checked inside the file and against existing students and accounts; another institute's courses and students are invisible; the import is written to the audit log.

### 📊 Reports & exports

*Reports & Exports* in the admin menu (and "Export" links on the Students, Fees, Attendance and Exams screens). Pick a report, set its filters, **preview it on screen**, then download it as **Excel (.xlsx)**, **PDF** or **CSV**. The filters live in the URL, so a configured report can be bookmarked or shared.

| Report | Contents |
|--------|----------|
| Student list | Contact, guardian, course, semester, status. Filter by course / semester / status. |
| Employee list | Department, designation, joining date. |
| Fee collection | Every payment in a period: receipt, student, method, what it paid for, who recorded it. Totals by method. Filter by dates / method / course. |
| Outstanding fees | Charged, waived, paid, outstanding, overdue and next due date per student, largest balance first. |
| Attendance summary / by subject | Per student (flagged under 75%) or one row per student per subject. Filter by course / dates / below %. |
| Exam results | One column per paper, AB for absent, total, %, GPA, result. |

Every report is one definition that feeds the preview, CSV, Excel and PDF, so the four cannot disagree. **Excel** files are real workbooks (written without a library): typed cells (amounts are numbers you can `SUM`, dates are real dates), a bold frozen header with filters, sensible column widths, and an *About this report* sheet recording the filters, totals, who generated it and when. Text is always written as literal text, so a cell such as `=HYPERLINK(...)` can never run as a formula (CSV values are defused the same way). **PDF** reports use the institute letterhead, show the filters and key figures, repeat the header row on every page, number the pages and choose landscape for wide reports; very wide reports show the essential columns in the PDF and say so (Excel has all). A PDF is refused above 4,000 rows and any export above 50,000 rows, with a message to narrow the filters.

Reports are read-only and admin-only; each is hidden (and blocked by URL) when the module it draws on is off for the institute. **Every export (not a preview) is written to the audit log** - who, which report, which format, which filters, how many rows.

### 💰 Vendor billing (PlanetU charging its institutes)

*Vendor console → Billing.* Every real institute has a **subscription** and is invoiced for it. Demo institutes (plan `demo`) are never billed.

**Price list** (rupees, before GST; edit any time under *Plans & pricing*; a change affects future invoices only, issued invoices keep their price):

| Plan | Monthly | Annual (2 months free) | Students included | Per extra student / month |
|------|---------|------------------------|-------------------|---------------------------|
| Basic | 1,999 | 19,990 | 300 | 8 |
| Standard | 4,999 | 49,990 | 1,000 | 5 |
| Premium | 9,999 | 99,990 | 3,000 | 3 |

New institutes start a **14-day free trial** (`BILLING_TRIAL_DAYS`). GST is added at `BILLING_GST_RATE` (default 18%). A plan is a *pricing tier by student capacity*: it does **not** switch modules on or off (you still set modules per institute, as before), so the default plan copy says only what is true. Extra students are billed per month of the period at the active-student count on the day the invoice is issued. Per institute you can also set a **discount %**, an **agreed monthly price**, the **grace period**, a **courtesy "paid until" date**, or **cancel at period end**.

**How recurring billing works.** Invoices, not auto-debit: the institute pays each cycle. About `BILLING_INVOICE_LEAD_DAYS` (7) days before the paid period ends, the next period's invoice is issued and emailed (a worker runs every few hours; *Run billing now* does it on demand; running it twice never double-bills). Paying (online, or recorded by you) extends "paid until". The institute then moves through: **active -> past due** (unpaid after the due date, access continues) **-> paused** (after the grace period, default 7 days). Reminders go out once each at 2 days before the due date, on it, 3 days after, and as a final notice. Plan/cycle changes apply from the *next* invoice; nothing is prorated, part-payments are refused, and a paid invoice cannot be voided.

**Paused institutes.** When access is paused for non-payment, students and staff cannot sign in (they are told to contact their administrator, never about billing), but the **institute admin can still sign in and sees only the Billing page**; paying there restores everyone instantly. A *manual* suspension from the console is different: nobody gets in, and a payment never lifts it. A lapsed trial or a cancelled subscription is re-opened by choosing a plan.

**Paying with Razorpay.** Subscriptions use the **same `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` as student fees** - nothing extra to configure, and no second webhook: the existing endpoint tells the two apart by the order's notes. The amount is always the invoice total worked out on the server; verification and the webhook can race harmlessly (one payment, one receipt); money that arrives for an invoice already paid another way, or for the wrong amount, is flagged on the console for you to refund, never double-counted. Institutes can also pay by bank transfer/UPI (details printed on the invoice), which you record under *Invoices -> Record payment*.

**GST invoices.** Each invoice is an A4 tax invoice with a consecutive number per financial year (`PU/26-27/0001`, at most 16 characters), CGST + SGST when the customer is in your state or IGST when not, SAC code, place of supply, amount in words, and payment instructions. Customer and vendor details are frozen on the invoice when it is issued. An institute must give its **state** (and a legal name) before it can be invoiced, because GST type depends on it; GSTINs are validated against the chosen state. *Invoices -> Excel register* exports a GST-style register for your accountant.

**Configure it** in `server/.env` (see `.env.example`): `BILLING_VENDOR_NAME/ADDRESS/STATE/GSTIN/PAN/EMAIL`, `BILLING_SAC`, `BILLING_GST_RATE`, `BILLING_BANK_DETAILS`, `BILLING_UPI_ID`, and the timing settings. **Have your CA confirm the GST rate, the SAC code, and whether e-invoicing applies to you** - they are configurable but not legal advice. Billing mail is sent from PlanetU (platform-level), not under an institute's name.

**Security.** An institute can *read* its own billing rows and nothing else; the database refuses any write to billing tables from an institute session (so an admin cannot mark their own invoice paid or grant themselves coverage), and the tenant for every institute-side call comes from the signed session. Every issue, payment, void, price change, suspension and register export is in the audit log.

### 🎓 Learning platform (MOOCs for compulsory credits)

*Students: Learning. Faculty and admins: Learning.* Turn the module on per institute (the vendor switches modules on per institute, see the end of this section). Teachers assign online courses to a class for a **subject**, for a number of **credits**, by a **due date**, **compulsory** or optional. Students complete them and the credits are added to their record.

**Two kinds of course** (kept in a shared catalogue; admins and faculty can add to it):

| Kind | Examples | How a student completes it |
|------|----------|----------------------------|
| Online MOOC (certificate) | NPTEL, SWAYAM, Coursera, edX, Udemy | Takes the course on the provider's site, then submits the **certificate** (a PDF/PNG/JPG upload, a verification link, or both, plus certificate number and score). The teacher **approves** (credits awarded) or **sends it back** with a reason; the student can resubmit. |
| In-house (lessons) | A short study-skills or orientation course | Reads or watches each lesson (reading text, a video link or a web link) and ticks it off. Finishing every lesson completes the course and awards the credits **automatically**. |

**Who can do what.** An admin can assign any course to any class. A faculty member can assign only for a **subject they teach in that class** (it must be on their timetable) and can review submissions for assignments they created or whose subject they teach. A faculty member opens a student's certificate only for assignments they manage; no other student file is visible to them. Students see only their own courses.

**Credits.** Each student sees *compulsory credits earned / required*, courses completed, items awaiting review, and what is overdue. "Required" is the total of the compulsory assignments; credits are awarded **only on completion or approval** (a reviewer may award fewer than the full credits, never more). The **Credits** tab shows every student's standing (complete / on track / overdue), and the Reports hub exports it (*Learning credits*). Students who join a class after a course was assigned are added with **Add new students** on the assignment. An assignment with submitted or completed work cannot be withdrawn, and a course that has been assigned cannot be deleted (archive it).

### 📝 Quizzes (for internal marks)

*Faculty and admins: Quizzes. Students: Quizzes, with an Internal marks tab.* A teacher sets a timed, auto-graded quiz for a class and subject; each quiz is worth a number of **internal marks**, and a student's score is scaled to that (17/20 on a quiz worth 10 is 8.5). The scaled marks of a subject's quizzes add up to its internal marks.

**Questions** (all auto-graded): single answer, multiple answers (partial credit: right picks minus wrong picks, never below zero), true/false, and short answer (case, spacing and number formatting ignored; several accepted answers allowed). Optional **negative marking** (a fraction of the marks lost for a wrong single/true-false answer; blanks are never penalised; a quiz total never goes below zero). Each question can carry an explanation shown with the answer.

**Settings.** Time limit, opening and closing time, attempts allowed (best or latest attempt counts), shuffled questions and options, and when students see their score: right after submitting, only after the quiz closes, or never. A teacher can **close** a quiz early (attempts in progress are submitted from what was saved), **reopen** it, and let one student have **another attempt**. Once students have attempted a quiz its questions, class and subject are locked; wording and timing can still be fixed.

**Fairness and trust.** The **server owns the clock**: the deadline is fixed when an attempt starts (and never later than the closing time) and enforced on every save and submit, with a few seconds' grace for a request already in flight. A student who closes the page is submitted automatically from their saved answers. The **correct answers never leave the server** while a student could use them: the answer key and explanations appear only once no attempts are left or the quiz is closed. Only one attempt per student can run at a time (enforced by the database), and answers are saved as the student goes, so a dropped connection or reload loses nothing. The quiz screen works on phones.

**Internal marks.** *Quizzes -> Internal marks* gives a class's marks per quiz and the total for a subject; the Reports hub exports it (*Internal marks (quizzes)*). A quiz that is still open shows as *pending* and is left out of the total until it closes or the student submits, so nobody is marked absent from a quiz that hasn't finished. Students see their own marks by subject.

**Turning them on.** `learning` and `quizzes` are modules like the others: new schools, colleges and universities have them by default, but **existing institutes do not get them automatically**. Enable them per institute in the vendor console (*Institutes -> Configure -> tick the module -> Save changes*). They are not tied to a billing plan. The change applies immediately, even to people already signed in (they just refresh). To switch both on for **every** existing institute at once:

```bash
psql postgres://erp_owner:erp_owner_dev@localhost:5432/planetu_erp -c "update tenants set modules = (select array_agg(distinct m) from unnest(modules || array['learning','quizzes']) m)"
```

**Can't see Learning or Quizzes in the menu?** Check, in order: (1) the institute has the modules ticked (above); (2) you ran `npm run db:migrate` (or `db:setup`) so migration 011 exists; (3) if you run the built app (`npm start`), run `npm run build` again, because the old build has no Learning or Quizzes screens.

### 💳 Online fee payment (Razorpay)

Students pay from **My Fees** by UPI, card or netbanking; the system reconciles automatically - no admin has to
type anything in. It is an add-on to the Fees module: when Razorpay confirms the money, an ordinary `payments`
row (method `online`, reference = the Razorpay payment id) is recorded through the *same* allocation logic the
admin uses, so balances, receipts (PDF) and reports need no special handling. Leave the keys blank and the
"Pay online" buttons simply don't appear; manual recording keeps working exactly as before.

**Set up**

1. Create keys in the [Razorpay dashboard](https://dashboard.razorpay.com) (start in **Test Mode**, keys begin `rzp_test_`).
2. Put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (any long random string) in `server/.env`.
3. Dashboard → Settings → **Payment Capture → Automatic**.
4. Dashboard → Settings → **Webhooks → Add**: URL `https://<your-domain>/api/webhooks/razorpay`, the same secret,
   events `payment.captured`, `order.paid`, `payment.failed`. On localhost, expose the API with `ngrok http 5000`.
5. `npm run db:migrate` (adds `007_online_payments.sql`).
6. Test with UPI `success@razorpay` / `failure@razorpay`, or card `4111 1111 1111 1111` (any future expiry, any CVV, any OTP).

**How it stays correct**

- The **server** decides the amount (the browser's number is only a request, re-checked against what is really owed);
  Razorpay is told in paise.
- Two independent confirmations, one result: the browser reports back (signature checked, and the payment is confirmed
  *captured* with Razorpay), **and** Razorpay calls the webhook (HMAC-verified over the raw body). Either alone is
  enough, so closing the tab right after paying still reconciles. The order row is locked while settling, so the two
  racing can never record a payment twice.
- If the money arrives but the ledger can no longer take it (e.g. the charge was paid in cash meanwhile), the order is
  flagged **Needs review** for an admin (Fees & Payments → *Online payments*) instead of being lost or failing the webhook.
- Tenant-safe: `online_payment_orders` has the same Row Level Security as every other table; the webhook has no session,
  so the institute is taken from the order's own notes (re-fetched from Razorpay with your keys when not in the payload).
- Security headers (CSP) allow only Razorpay's own hosts; order creation is rate-limited (10/min per IP).

---

## 5. Multi-tenancy — how client data is kept apart

**One database, shared tables, a `tenant_id` on every row, enforced by PostgreSQL itself.**

| Layer | What it guarantees |
|-------|--------------------|
| **Row Level Security** | Every tenant table has a policy `tenant_id = current tenant`. The API connects as a restricted role (`erp_app`: not a superuser, no `BYPASSRLS`), so even a controller that forgets a `WHERE` clause cannot read or write another client's rows. With no tenant set, every query returns **zero rows** (fails closed). |
| **Tenant comes from the session, never the client** | The signed session cookie carries the tenant id. Each request runs in **one transaction** that sets it; headers, query strings or body fields naming a tenant are ignored. |
| **Composite foreign keys** | Child rows reference parents by `(tenant_id, id)` — an employee physically cannot point at another client's department, even through a bug. |
| **Scoped login** | Users sign in with an **institute code + ID**. The same ID (`ADM001`) exists in every demo institute and resolves to a different person in each. Unknown code, wrong role and wrong password all give one generic message. |
| **Config, not code** | A client's *type* (school / college / university / company) selects a preset — which modules are on and what things are called. The vendor can override both per client. Modules are enforced **on the server** (`403 MODULE_DISABLED`), and the menu hides them. |
| **Append-only audit log** | Vendor actions and key admin actions are recorded; the app's DB role cannot `UPDATE` or `DELETE` audit rows. |
| **Tested** | `npm test` runs a suite against a real PostgreSQL (see *Tests* in section 1), and the suite itself was mutation-checked: switching RLS off on a table makes it fail. |

The vendor console (Super Admin) works in a *platform* context: it can list clients and users but
**cannot read a client's business data** (students, employees, timetable…). Per-client counts on
the console are gathered by explicitly switching into each client.

---

## 6. Project structure

```
planetu-erp/
├── package.json                npm workspaces root (dev / build / start / db:setup / db:migrate / create-vendor / test)
├── docker-compose.yml          local PostgreSQL
├── render.yaml                 Render Blueprint (web service + database)
├── RENDER.md  DEPLOY.md        step-by-step deployment guides (Render, Oracle Cloud)
├── scripts/git-history.sh      builds the feature-by-feature Git history
├── deploy/                     systemd unit, Caddy config, env template, backup and update scripts (Oracle)
├── server/
│   ├── .env.example
│   ├── migrations/             001-012: 12 SQL files, e.g. 001_multi_tenant_core.sql, 012_file_blobs.sql
│   ├── test/                   19 suites: accounts, admissions, assets, attendance, billing, exams, fees, files, isolation, learning, library, migrate, onlinePayments, quizzes, reports, storage, studentImport, students, vendor
│   └── src/
│       ├── server.js           entry point (checks the database role, bootstraps the owner login, then listens)
│       ├── app.js              Express app, security middleware, route mounting
│       ├── config/             env.js, modules.js (module catalogue + per-type presets)
│       ├── db/                 pool.js (tenant-scoped transactions), migrate.js, repo.js, series.js, audit.js,
│       │                       vendor.js + create-vendor-cli.js, seed.js, demo-data.js
│       ├── middleware/         auth.js (requireAuth = session + tenant transaction, requireRole, requireModule), error.js
│       ├── storage/            local.js (disk), db.js (inside PostgreSQL), index.js (STORAGE_DRIVER)
│       ├── mail/               transport.js (SMTP / console), templates.js
│       ├── services/           accounts, admissions, assets, attendance, billing, billingConsole, billingPayments, billingRun, captcha, exams, fees, files, idcard, invoicepdf, learning, library, notifications, onlinePayments, quiz, razorpay, receipt, reportcard, reports, studentImport, students, teaching, tenant, timetable
│       ├── controllers/        admin, admissions, assets, attendance, auth, billing, exams, fees, files, learning, library, onlinePayments, publicAdmissions, quiz, reports, student, students, superadmin
│       ├── routes/             admin, auth, employee, files, public, student, superadmin (+ wrap.js helpers)
│       └── utils/              dates.js, asyncHandler.js, ids.js
└── client/
    ├── vite.config.js          dev proxy: /api -> localhost:5000
    ├── public/                 logo-mark.png, logo-full.png, favicon.svg
    └── src/
        ├── App.jsx             route table (module gates per route)
        ├── config/             menu.config.js (sidebar per role, module + terminology aware), brand.js
        ├── context/            AuthContext.jsx (session + the institute's config)
        ├── hooks/              useTenantConfig.js (hasModule / t() terminology), useFetch, ...
        ├── api/http.js         fetch wrapper (get/post/put/del)
        ├── components/         auth/, layout/AppShell.jsx, ui/ (Modal, Tabs, Card, DocumentViewer ...), fees/, billing/ ...
        ├── pages/
        │   ├── Login.jsx, ChangePassword.jsx, ForgotPassword.jsx, ResetPassword.jsx, ComingSoon.jsx, NotFound.jsx
        │   ├── student/        Attendance, Calendar, Dashboard, Fees, Institute, Learning, LearningCourse, Library, Profile, QuizResult, QuizTake, Quizzes, Results, Timetable
        │   ├── admin/          Admissions, Assets, Attendance, Billing, Calendar, Dashboard, Departments, Employees, ExamDetail, Exams, Fees, Institute, Library, Reports, StudentImport, Students, Timetable
        │   ├── employee/       Attendance, Dashboard, Exams
        │   ├── shared/         EnterMarks, LearningAssignment, LearningManage, MarkAttendance, QuizEditor, QuizManage, QuizResults
        │   ├── superadmin/     Billing, Dashboard, Institutes
        │   └── public/         Apply, ApplyStatus
        └── styles/global.css
```

### API summary

| Method | Path                              | Access          |
|--------|-----------------------------------|-----------------|
| GET    | `/api/health`                     | public          |
| GET    | `/api/auth/tenant/:code`          | public *(institute display name only)* |
| POST   | `/api/auth/captcha/verify`        | public          |
| GET    | `/api/auth/captcha/challenge`     | public (new maths question) |
| POST   | `/api/auth/captcha/challenge`     | public (submit answer)      |
| POST   | `/api/auth/login`                 | public + captcha *(body: `tenantCode`, `role`, `identifier`, `password`)* |
| GET    | `/api/auth/me`                    | signed in       |
| POST   | `/api/auth/forgot-password`, `/api/auth/reset-password` | public *(captcha / emailed token)* |
| POST   | `/api/auth/change-password`       | signed in *(allowed on a temporary password)* |
| POST   | `/api/auth/logout`                | signed in       |
| GET    | `/api/student/dashboard`          | student         |
| GET    | `/api/student/profile`            | student         |
| GET    | `/api/student/institute`          | student *(public fields only)* |
| GET    | `/api/student/calendar?year&month`| student         |
| GET    | `/api/student/timetable?start&end&department&employeeId&subject&priority` | student |
| GET    | `/api/student/attendance`         | student *(subjects, overall %, recent log)* |
| GET    | `/api/student/results`            | student *(published exams, grades, GPA, CGPA)* |
| GET    | `/api/student/results/:id/report-card.pdf` | student *(own, published only)* |
| GET    | `/api/employee/exams/papers`      | employee *(papers assigned to them)* |
| GET/PUT| `/api/employee/exams/papers/:paperId/marks` | employee *(own paper; locked once published)* |
| GET    | `/api/employee/attendance/today`  | employee *(their lectures today + marking status)* |
| GET/PUT| `/api/employee/attendance/lecture?slotId&date` | employee *(own lecture, today only)* |
| GET    | `/api/admin/dashboard`            | admin           |
| GET/PUT| `/api/admin/institute`            | admin           |
| POST/PUT/DELETE | `/api/admin/institute/{authorized-persons\|stakeholders\|documents\|beneficiaries}/:index` | admin |
| PUT    | `/api/admin/institute/stamp`      | admin           |
| GET/POST/PUT/DELETE | `/api/admin/courses`, `/api/admin/courses/:id` | admin *(classes / courses / programmes; DELETE is refused while anything still uses the course)* |
| GET/POST/PUT/DELETE | `/api/admin/departments`, `/api/admin/departments/:id` | admin |
| GET/POST/DELETE | `/api/admin/designations`, `/api/admin/designations/:id` | admin |
| GET/POST/PUT/DELETE | `/api/admin/employees`, `/api/admin/employees/:id` | admin |
| GET/POST/PUT/DELETE | `/api/admin/calendar`, `/api/admin/calendar/:id` | admin |
| GET    | `/api/admin/timetable`, `/api/admin/timetable/filters`, `/api/admin/timetable/slots` | admin |
| POST/PUT/DELETE | `/api/admin/timetable/slots/:id` | admin |
| PUT    | `/api/admin/timetable/reassign`, `/api/admin/timetable/reassign/undo` | admin |
| GET    | `/api/admin/attendance/day?date&courseId` | admin *(every lecture + submitted or not)* |
| GET/PUT| `/api/admin/attendance/lecture?slotId&date` | admin *(mark / correct any past or present date)* |
| GET    | `/api/admin/attendance/report`, `/api/admin/attendance/report.csv` (`courseId&subject&from&to&below`) | admin |
| GET    | `/api/admin/students/import/template.csv` | admin |
| POST   | `/api/admin/students/import/preview`, `/api/admin/students/import` (multipart `file`; fields `createLogins`, `sendEmails`, `skipInvalid`) | admin *(preview writes nothing; import is all-or-nothing)* |
| GET    | `/api/admin/reports` | admin *(reports available to this institute, with their filters)* |
| GET    | `/api/admin/billing` | admin *(own subscription, usage, invoices; still reachable while access is paused for non-payment)* |
| PUT    | `/api/admin/billing/profile`, `/api/admin/billing/change` · POST `/api/admin/billing/choose-plan` | admin *(billing details; plan change from next invoice / cancel; pick a plan)* |
| GET/POST | `/api/admin/billing/invoices/:id/pdf`, `/api/admin/billing/invoices/:id/order`, `/api/admin/billing/verify` | admin *(GST invoice PDF; Razorpay order for exactly the invoice total; verify checkout)* |
| GET    | `/api/super-admin/billing/overview`, `/subscriptions`, `/plans`, `/review-orders` | super admin *(MRR/receivables, institutes, price list, payments needing a human)* |
| PUT    | `/api/super-admin/billing/plans/:key`, `/billing/tenants/:id/subscription`, `/billing/tenants/:id/profile` | super admin *(edit prices; per-institute terms; billing details)* |
| POST   | `/api/super-admin/billing/tenants/:id/invoices`, `/billing/run`, `/billing/invoices/:id/payments`, `/void`, `/remind` | super admin *(issue next invoice; run billing now; record an offline payment; void; remind)* |
| GET    | `/api/super-admin/billing/invoices` (`?status&from&to&search&tenantId&format=json\|csv\|xlsx`) | super admin *(invoice list and GST register)* |
| GET    | `/api/admin/reports/:key?format=json\|csv\|xlsx\|pdf&...filters` | admin *(keys: students, employees, fee-collection, fee-dues, attendance, attendance-subject, exam-results)* |
| GET/POST | `/api/admin/exams` (`?courseId&status`) | admin |
| GET/PUT/DELETE | `/api/admin/exams/:id` | admin *(delete: drafts only)* |
| POST/PUT/DELETE | `/api/admin/exams/:id/papers`, `/api/admin/exams/:id/papers/:paperId` | admin *(drafts only)* |
| GET/PUT | `/api/admin/exams/:id/papers/:paperId/marks` | admin *(any paper; corrections after publishing are audited)* |
| POST   | `/api/admin/exams/:id/publish`, `/api/admin/exams/:id/unpublish` | admin |
| GET    | `/api/admin/exams/:id/results`, `/results.csv`, `/report-cards.pdf`, `/students/:studentId/report-card.pdf` | admin |
| GET/PUT/DELETE | `/api/admin/exams/grading` | admin *(institute grade bands; DELETE = back to built-in)* |
| GET    | `/api/admin/audit`                | admin *(last 100 entries)* |
| GET    | `/api/admin/students`, `/api/admin/students/:id` | admin *(module `students`)* |
| PUT    | `/api/admin/students/:id`, `/api/admin/students/:id/photo` | admin |
| GET    | `/api/admin/students/:id/id-card.pdf` | admin *(module `id_cards`)* |
| GET    | `/api/student/id-card.pdf`        | student *(own card only, module `id_cards`)* |
| GET/POST | `/api/admin/fees/structures`, `.../structures/:id/assign`, `.../structures/:id/bulk-assign` | admin *(module `fees`)* |
| GET/POST | `/api/admin/fees/payments`, `.../payments/:id/receipt.pdf` | admin |
| GET/POST | `/api/admin/fees/students/:id`, `.../students/:id/items`, `PUT .../items/:itemId/waive` | admin |
| GET    | `/api/student/fees`, `/api/student/fees/payments`, `/api/student/fees/payments/:id/receipt.pdf` | student *(own record only)* |
| GET/POST | `/api/student/fees/online/config`, `.../online/orders`, `.../online/verify` | student *(Razorpay checkout; orders rate-limited)* |
| GET/PUT | `/api/admin/fees/online-orders`, `.../online-orders/:id/resolve` | admin *(reconcile online payments)* |
| POST   | `/api/webhooks/razorpay`          | public, authenticated by Razorpay's HMAC signature (raw body) |
| GET/POST | `/api/admin/library/books`, `/api/admin/library/issues` | admin *(module `library`)* |
| PUT    | `/api/admin/library/issues/:id/return`, `.../pay-fine` | admin |
| GET    | `/api/student/library/books`, `/api/student/library/my-issues` | student |
| GET/POST | `/api/admin/assets`, `.../assets/:id/maintenance` | admin *(module `assets`)* |
| PUT    | `/api/admin/assets/:id/assign`, `.../unassign`, `.../status` | admin |
| GET    | `/api/admin/admissions`, `/api/admin/admissions/:id` | admin *(module `admissions`)* |
| PUT    | `/api/admin/admissions/:id/documents/:docId` | admin *(verify / reject a document)* |
| POST   | `/api/admin/admissions/:id/decision`, `/api/admin/admissions/:id/enroll` | admin |
| POST/GET | `/api/files`, `/api/files/:id`  | signed in *(uploader, institute admin, or a faculty member reviewing certificates for their own learning assignments)*. A file is **shown inline** by default so it can be viewed on screen (admissions review uses an on-page viewer with Verify / Reject beside the document); it is saved to disk only with `?download=1`. PDFs are not sandboxed (Chrome would refuse to display them); images are. |
| GET    | `/api/public/:code/admissions/info` | public |
| POST   | `/api/public/:code/admissions/applications`, `.../applications/lookup`, `.../applications/recover` | public *(captcha / access code)* |
| GET/POST | `/api/public/:code/admissions/applications/:id`, `.../documents`, `.../submit` | applicant *(header `x-access-code`)* |
| GET    | `/api/super-admin/presets`, `/api/super-admin/dashboard` | super admin |
| GET/POST | `/api/super-admin/tenants`      | super admin *(create returns a one-time admin password)* |
| GET/PUT | `/api/super-admin/tenants/:id`   | super admin *(name, plan, status, modules, terminology)* |
| POST   | `/api/super-admin/tenants/:id/reset-admin-password` | super admin |
| GET    | `/api/{admin,employee}/learning/{subjects,courses,assignments,review,compliance}` | admin, faculty *(module `learning`; faculty see only subjects they teach)* |
| POST/PUT/DELETE | `/api/{admin,employee}/learning/courses`, `.../assignments`, `.../assignments/:id/sync` | admin, faculty *(assign a course to a class and subject)* |
| POST   | `/api/{admin,employee}/learning/enrollments/:id/review` | admin, faculty *(approve or send back a certificate)* |
| GET    | `/api/student/learning`, `/api/student/learning/:enrollmentId` | student *(own courses, credits)* |
| POST/PUT | `/api/student/learning/:enrollmentId/start`, `.../lessons/:lessonId`, `.../submit` | student *(progress, certificate)* |
| GET/POST/PUT/DELETE | `/api/{admin,employee}/quizzes`, `.../quizzes/:id`, `.../publish`, `.../close`, `.../reopen` | admin, faculty *(module `quizzes`; faculty set quizzes for subjects they teach)* |
| GET/POST | `/api/{admin,employee}/quizzes/:id/results`, `.../extra-attempts`, `/quizzes/internal-marks` | admin, faculty |
| GET    | `/api/student/quizzes`, `/api/student/internal-marks`, `/api/student/quizzes/:id/result` | student *(own results; the answer key is withheld until it is safe to show)* |
| POST/PUT | `/api/student/quizzes/:id/start`, `.../answers`, `.../submit` | student *(the server owns the clock and grades the answers)* |
| GET    | `/api/super-admin/diagnostics/network` | super admin *(shows the IP the app sees; use it to check `TRUST_PROXY_HOPS`)* |

Calendar and Timetable routes (admin and student) answer `403 MODULE_DISABLED` when the institute's plan doesn't include them.

---

## 7. Deployment

Pick the host that suits you. Both have a full step-by-step guide in this repository.

| Host | Guide | Good for |
|------|-------|----------|
| **Render** *(free plan, no card needed)* | [`RENDER.md`](RENDER.md) + [`render.yaml`](render.yaml) | Demos and quick sharing. One Blueprint creates the web service and its database. The free plan sleeps after 15 idle minutes, the free database is deleted 30 days after creation unless moved or upgraded, and it has no backups. |
| **Oracle Cloud** *(Always Free VM, card needed for verification)* | [`DEPLOY.md`](DEPLOY.md) + [`deploy/`](deploy/) | A server that never sleeps, with a real disk. More setup: Node 24, PostgreSQL, Caddy (HTTPS), systemd, nightly backups. |

Two modes make the same code run on both:

| Setting | Normal server | Render free plan |
|---------|---------------|------------------|
| `DB_SINGLE_ROLE` | off — the app connects as the restricted `erp_app` role | `true` — one ordinary database login runs the app; Row Level Security is still **forced** on every tenant table and the server refuses to start if that login could bypass it |
| `STORAGE_DRIVER` | `local` — uploaded files on disk (`UPLOAD_DIR`) | `db` — files stored inside PostgreSQL, because the free plan's disk is wiped on every restart |
| Owner login | `npm run create-vendor` | `VENDOR_LOGIN` / `VENDOR_EMAIL` / `VENDOR_PASSWORD` settings (the free plan has no Shell) |

**Never run `npm run db:setup` on a real server:** it creates demo logins with public passwords, and it refuses to run in production.

### Production-style run

```bash
npm run build
cp server/.env.example server/.env    # set JWT_SECRET, DATABASE_URL, MIGRATE_DATABASE_URL, APP_DB_PASSWORD
npm run db:migrate
npm run create-vendor -- --login=yourlogin --email=you@example.com
NODE_ENV=production npm start         # serves the API and the built app on :5000
```

Set `NODE_ENV=production`, `JWT_SECRET`, `COOKIE_SECURE=true` (HTTPS) and `APP_URL`. Email needs `MAIL_TRANSPORT=smtp`
with `SMTP_URL`; without it, emails are only printed in the server log. Fill the `BILLING_VENDOR_*` details before
issuing the first GST invoice. Razorpay keys are only needed for online payments.

### Git history

`scripts/git-history.sh` turns the project into a clean, feature-by-feature Git history (one commit per feature, with
proper messages) and refuses to commit any secret. It can start a new repository or build on top of an existing one.
See Part A of [`RENDER.md`](RENDER.md).

---

## 8. Adding the next modules

Every new module follows the same recipe, and gets multi-tenancy almost for free:

1. **Schema:** add `migrations/00N_<module>.sql`. Give each table `tenant_id uuid not null default app_tenant()
   references tenants(id) on delete cascade`, a `unique (tenant_id, id)`, **composite foreign keys**
   `(tenant_id, parent_id)` to other tenant tables, and add the table name to the RLS list (copy the
   `do $$ ... $$` block at the bottom of migration 001). The `tenant_isolation` policy is what keeps clients apart.
2. **Catalogue:** the module's key is already listed in `server/src/config/modules.js` (or add it), including which
   client types get it by default.
3. **Backend:** controller + router; protect with `requireAuth, requireRole(...), requireModule('<key>')`. Queries just
   use `q(...)` — never pass a tenant id around, and never trust one from the request.
4. **Numbers:** for business IDs (PRN, receipt no., library card) use `nextNumber('<series>', { prefix, padding })`
   from `db/series.js` — atomic and per-tenant.
5. **Frontend:** page under `client/src/pages/...`, a `<Route>` inside a `<ModuleGate module="...">`, and one entry in
   `config/menu.config.js` with its `module` (and `term` for tenant-specific labels).
6. **Test:** add a case to `server/test/isolation.test.js` proving client A cannot reach client B's records.

**On the roadmap** (switchable in the vendor console, marked "coming soon" until built): Leave & Shifts · Payroll ·
Hostel · Transport · Notice Board · Certificates · Visitor Management.


---

## 9. Notes

- All institute, student, and employee data is fictional demo data. **PlanetU Technovision is the vendor brand**
  (login page, platform console); each client shows its own name once signed in.
- **Branding** of the platform lives in `client/src/config/brand.js`. Each client's own profile (address, phone,
  contacts) is edited by its admin under *Institute*. The PlanetU mark ships at `client/public/logo-mark.png`
  (sidebar + login) and `logo-full.png` (full lockup).
- The old JSON-file store is gone — PostgreSQL replaced it. If you ran an earlier build, run `npm run db:setup`
  (this re-creates the demo institutes) or `npm run db:migrate` (keeps your data).
- Demo institutes' calendar/timetable dates are re-anchored to today on every start in development
  (`DEMO_REFRESH`), so the demo always looks current. Records an admin adds by hand are left alone.
- **Public demo mode** (`DEMO_MODE=true`, on in `render.yaml`): loads the three sample institutes at start-up if they are missing and shows one-click sample sign-ins on the login page. It never offers or creates the platform-owner login, and the shared demo passwords cannot be changed. See [`RENDER.md`](RENDER.md).
- Learning and Quizzes are modules like the others: new institutes have them on by default, **existing institutes
  must have them switched on** in the vendor console.
- **Not built yet:** SMS, per-institute sender domains for email, malware scanning of uploads, automatic purge of
  abandoned admission drafts, essay questions and manual re-grading in quizzes, notifications when a course or
  quiz is assigned, and the roadmap modules listed above.
- Set `JWT_SECRET` before any real deployment. The server refuses to start in production without it.

---

<p align="center">Built with ☕ and 🧠 by <a href="https://github.com/NeerajGupta18">Neeraj Sudesh Gupta</a></p>

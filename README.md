<p align="center">
  <img src="client/public/logo-full.png" width="360" alt="PlanetU Technovision" />
</p>

<h1 align="center">🎓 PlanetU Technovision — Campus ERP</h1>
<p align="center"><em>Elevate your Ideas — a full-stack ERP for students, employees and institute admins.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Auth-JWT%20%2B%20bcrypt-EC1C24?style=for-the-badge&logo=jsonwebtokens&logoColor=white" />
  <img src="https://img.shields.io/badge/STATUS-PHASE%202-2ea44f?style=for-the-badge" />
</p>

---

## 📌 Overview

A **role-based Campus ERP** built from scratch in plain JavaScript — Node.js + Express on the
backend, React + Vite on the frontend, no database server required (a single JSON file is the
store, swappable later without touching any controller).

Four roles share one shell and one login screen, each landing on their own module set:
**Super Admin, Admin, Student, Employee.** Every login goes through an "I'm not a robot" check
(custom human-detection by default, or Google reCAPTCHA v2 the moment you drop in a site/secret
key pair — no code change either way).

**Phase 1** shipped the login + the 5 Student modules. **Phase 2** (this update) ships the full
**Admin** side — 6 modules — plus tightened data boundaries between what a Student can see and
what only an Admin can.

---

## ✅ What's built

| Phase | Role | Modules |
|-------|------|---------|
| 1 | 🎓 Student | Dashboard · Profile · Institute *(public info only)* · Calendar · Timetable |
| 2 | 🛠️ Admin | Admin Dashboard · Institute *(details, stakeholders, authorized persons, documents, bank accounts, stamp & e-sign)* · Departments & Designations · Employees · Calendar *(full month-grid view)* · Timetable / Lecture Reassignment |
| — | 👑 Super Admin | Coming soon (lands on a placeholder dashboard) |
| — | 👔 Employee | Coming soon (lands on a placeholder dashboard) |

**Student vs. Admin data boundary:** a student only ever sees the institute's public profile
(name, tagline, address, contact). Stakeholders, authorized persons' PAN/Aadhaar, documents, bank
beneficiary details and the institute stamp/signature are Admin-only — stripped server-side from
the student API response, not just hidden in the UI, and the admin routes are behind
`requireRole('admin')` so a student session gets a `403` if it tries to reach them directly.

---

## 1. Quick start

Requirements: **Node.js 18.11 or newer** and npm.

```bash
# from the project root
npm install          # installs both workspaces (server + client)
npm run dev          # starts API on :5000 and the web app on :5173
```

Open **http://localhost:5173**

No database server is needed. On first run the API creates `server/data/db.json`
with demo data. To reset the demo data at any time:

```bash
npm run seed
```

### Production-style run

```bash
npm run build        # builds client/dist
cp server/.env.example server/.env   # then set a long random JWT_SECRET
NODE_ENV=production npm start        # Express serves API + built client on :5000
```

---

## 2. Demo accounts

Pick the matching role on the login screen. Passwords are case-sensitive and the role is
checked on the server, so a Student ID will not log in under the Admin role.

| Role        | ID / Email                                       | Password         |
|-------------|---------------------------------------------------|------------------|
| Super Admin | `SA001`                                            | `SuperAdmin@123` |
| Admin       | `ADM001`                                           | `Admin@123`      |
| Student     | `STU2026001` (or `aarav.sharma@student.erp.com`)   | `Student@123`    |
| Employee    | `EMP001`                                           | `Employee@123`   |

In development mode the login page has a "fill demo credentials" shortcut. It is removed from production builds.

Student and Admin are fully built. Super Admin and Employee can sign in and land on a
"coming soon" dashboard, and are blocked from the Student/Admin routes.

---

## 3. How the login and "I'm not a robot" check work

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

Other login protections: bcrypt password hashing, httpOnly JWT session cookie, generic
"Incorrect ID, password or role" message, lockout after 5 failed attempts (15 minutes),
rate limiting, Helmet security headers (including a Content-Security-Policy that allows
Google's reCAPTCHA script/iframe only — see `server/src/app.js`).

---

## 4. Project structure

```
campus-erp/
├── package.json                npm workspaces root (dev / build / start / seed)
├── server/
│   ├── .env.example
│   └── src/
│       ├── server.js           entry point
│       ├── app.js              Express app, security middleware, route mounting
│       ├── config/env.js
│       ├── db/                 seed.js (demo data), store.js (JSON store), seed-cli.js
│       ├── middleware/         auth.js (requireAuth, requireRole), error.js
│       ├── services/           captcha.service.js, timetable.service.js
│       ├── controllers/        auth.controller.js, student.controller.js, admin.controller.js
│       ├── routes/             auth.routes.js, student.routes.js, admin.routes.js
│       └── utils/               dates.js, asyncHandler.js, ids.js
└── client/
    ├── vite.config.js          dev proxy: /api -> localhost:5000
    ├── public/                 logo-mark.png, logo-full.png, favicon.svg
    └── src/
        ├── App.jsx             route table
        ├── config/              menu.config.js (sidebar per role), brand.js (name/tagline/logo)
        ├── context/AuthContext.jsx
        ├── api/http.js         fetch wrapper (get/post/put/del)
        ├── components/         auth/, layout/AppShell.jsx, ui/ (Modal, Tabs, Card, StatCard…)
        ├── pages/
        │   ├── Login.jsx, ComingSoon.jsx, NotFound.jsx
        │   ├── student/        Dashboard, Profile, Institute, Calendar, Timetable
        │   └── admin/           Dashboard, Institute, Departments, Employees, Calendar, Timetable
        ├── hooks/  utils/
        └── styles/global.css
```

### API summary

| Method | Path                              | Access          |
|--------|-----------------------------------|-----------------|
| GET    | `/api/health`                     | public          |
| GET    | `/api/public/institute`           | public          |
| POST   | `/api/auth/captcha/verify`        | public          |
| GET    | `/api/auth/captcha/challenge`     | public (new maths question) |
| POST   | `/api/auth/captcha/challenge`     | public (submit answer)      |
| POST   | `/api/auth/login`                 | public + captcha|
| GET    | `/api/auth/me`                    | signed in       |
| POST   | `/api/auth/logout`                | signed in       |
| GET    | `/api/student/dashboard`          | student         |
| GET    | `/api/student/profile`            | student         |
| GET    | `/api/student/institute`          | student *(public fields only)* |
| GET    | `/api/student/calendar?year&month`| student         |
| GET    | `/api/student/timetable?start&end&department&employeeId&subject&priority` | student |
| GET    | `/api/admin/dashboard`            | admin           |
| GET/PUT| `/api/admin/institute`            | admin           |
| POST/PUT/DELETE | `/api/admin/institute/{authorized-persons\|stakeholders\|documents\|beneficiaries}/:index` | admin |
| PUT    | `/api/admin/institute/stamp`      | admin           |
| GET/POST/PUT/DELETE | `/api/admin/departments`, `/api/admin/departments/:id` | admin |
| GET/POST/DELETE | `/api/admin/designations`, `/api/admin/designations/:id` | admin |
| GET/POST/PUT/DELETE | `/api/admin/employees`, `/api/admin/employees/:id` | admin |
| GET/POST/PUT/DELETE | `/api/admin/calendar`, `/api/admin/calendar/:id` | admin |
| GET    | `/api/admin/timetable`, `/api/admin/timetable/filters`, `/api/admin/timetable/slots` | admin |
| POST/PUT/DELETE | `/api/admin/timetable/slots/:id` | admin |
| PUT    | `/api/admin/timetable/reassign`, `/api/admin/timetable/reassign/undo` | admin |

---

## 5. Adding the next modules (Employee, Super Admin)

The structure is set up so later phases follow the same pattern already used for Admin:

1. **Backend:** add `controllers/employee.controller.js` and `routes/employee.routes.js`, protect
   with `requireAuth, requireRole('employee')`, and mount in `app.js` (a comment marks the spot).
2. **Frontend:** add pages under `client/src/pages/employee/`, register routes in `App.jsx`
   (replace the `ComingSoon` placeholder for that role), and add menu entries in `config/menu.config.js`.
3. **Data:** extend `db/seed.js` with any new collections. When ready for a real database, replace
   `db/store.js` (MongoDB / PostgreSQL) — controllers only ever talk to `db()`.

---

## 6. Notes

- All institute, student, and employee data is fictional demo data. Only the organisation name
  and tagline are real.
- **Branding** lives in two places: `client/src/config/brand.js` (name, tagline, logo path) and the
  `institute` block in `server/src/db/seed.js` (address, phone, contacts). The official PlanetU
  mark ships at `client/public/logo-mark.png` (sidebar + login) and `logo-full.png` (full lockup).
- If you ran an earlier build, run `npm run seed` once to reset the old demo data.
- Dates in the seeded calendar/timetable are re-anchored to today on every start, so the demo
  always looks current.
- Set `JWT_SECRET` before any real deployment. The server refuses to start in production without it.

---

<p align="center">Built with ☕ and 🧠 by <a href="https://github.com/NeerajGupta18">Neeraj Sudesh Gupta</a></p>

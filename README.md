# PlanetU Technovision ERP — Phase 1

*Elevating ideas into digital success.*

Role-based login (Super Admin, Admin, Student, Employee) with an "I'm not a robot" check,
plus the first five Student modules: **Dashboard, Profile, Institute, Calendar, Timetable**.

Everything is plain **JavaScript** (no TypeScript). Node.js + Express on the backend, React + Vite on the frontend.

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

| Role        | ID / Email                                   | Password         |
|-------------|----------------------------------------------|------------------|
| Super Admin | `SA001`                                      | `SuperAdmin@123` |
| Admin       | `ADM001`                                     | `Admin@123`      |
| Student     | `STU2026001` (or `aarav.sharma@student.erp.com`) | `Student@123`    |
| Employee    | `EMP001`                                     | `Employee@123`   |

In development mode the login page has a "fill demo credentials" shortcut. It is removed from production builds.

Only the **Student** portal is built in this phase. Admin, Super Admin and Employee can
sign in and land on a "coming soon" dashboard, and are blocked from the Student routes.

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
├── package.json              npm workspaces root (dev / build / start / seed)
├── server/
│   ├── .env.example
│   └── src/
│       ├── server.js         entry point
│       ├── app.js            Express app, security middleware, route mounting
│       ├── config/env.js
│       ├── db/               seed.js (demo data), store.js (JSON store), seed-cli.js
│       ├── middleware/       auth.js (requireAuth, requireRole), error.js
│       ├── services/         captcha.service.js, timetable.service.js
│       ├── controllers/      auth.controller.js, student.controller.js
│       ├── routes/           auth.routes.js, student.routes.js
│       └── utils/
└── client/
    ├── vite.config.js        dev proxy: /api -> localhost:5000
    └── src/
        ├── App.jsx           route table
        ├── config/menu.config.js   sidebar menu per role
        ├── context/AuthContext.jsx
        ├── api/http.js       fetch wrapper
        ├── components/       auth/, layout/AppShell.jsx, ui/
        ├── pages/            Login.jsx, student/{Dashboard,Profile,Institute,Calendar,Timetable}.jsx
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
| GET    | `/api/student/institute`          | student         |
| GET    | `/api/student/calendar?year&month`| student         |
| GET    | `/api/student/timetable?start&end&department&employeeId&subject&priority` | student |

---

## 5. Adding the next modules

The structure is set up so later phases follow the same pattern:

1. **Backend:** add `controllers/admin.controller.js` and `routes/admin.routes.js`, protect with
   `requireAuth, requireRole('admin')`, and mount in `app.js` (a comment marks the spot).
2. **Frontend:** add pages under `client/src/pages/admin/`, register routes in `App.jsx`
   (replace the `ComingSoon` placeholder for that role), and add menu entries in `config/menu.config.js`.
3. **Data:** extend `db/seed.js` with the new collections. When you are ready for a real
   database, replace `db/store.js` (MongoDB / PostgreSQL) — controllers only talk to `db()`.

---

## 6. Notes

- All institute, student, and employee data is fictional demo data. Only the organisation name
  and tagline (PlanetU Technovision — Elevating ideas into digital success) are real.
- **Branding** lives in two places: `client/src/config/brand.js` (name, tagline, logo path) and the
  `institute` block in `server/src/db/seed.js` (address, phone, contacts — currently blank/placeholder).
  Replace `client/public/logo.svg` and `client/public/favicon.svg` with the official logo.
- If you ran an earlier build, run `npm run seed` once to reset the old demo data.
- Dates in the seeded calendar/timetable are re-anchored to today on every start, so the demo
  always looks current.
- Set `JWT_SECRET` before any real deployment. The server refuses to start in production without it.

# PlanetU Campus ERP

Multi-tenant Campus ERP (schools, colleges, universities) built by Neeraj for PlanetU Technovision.
Repo: github.com/NeerajGupta18/planetu-erp. Live: https://planetu-erp.onrender.com (Render, auto-deploys from `main`).

## Stack
- Node/Express + PostgreSQL with forced row-level security (RLS)
- React 18 + Vite, npm workspaces (`server`, `client`)
- Android: Capacitor 7 wrapper in `android-app/` (built by GitHub Actions). PWA for iPhone and desktop.
- Render deploy runs `npm run db:migrate && npm start`

## Commands
- Tests: `node --test --test-concurrency=1` (690 passing; run the full set once at the end of each day, targeted tests while working)
- Demo data: `npm run db:setup` (re-run after tests or e2e to reseed)

## Rules
1. Never push directly to `main`. Work on one branch per day (e.g. `day-1-shared-ui`). Neeraj merges to `main` after tests pass and he has checked it on his phone.
2. Commit in small steps with clear messages. Ask before pushing.
3. Do not rely on DB migrations updating `tenants` rows on the live host (RLS). Gate features from tenant type or code instead.
4. Build on the existing system. No rewrites. Keep all existing tests passing.
5. Documents for his mam: plain simple text PDFs, no dates, modest wording.
6. Do not read the whole repo. Look only at the files the day's task needs.
7. Use plan mode at the start of each day: propose file changes, wait for approval, then build.
8. For any screen, component or layout work, use the ui-ux-pro-max skill first. Query it for style, colour, typography and UX rules, and keep the choices consistent across all screens.

## Already built (do not redo)
- QR check-in v2 (rotating signed token, optional 150 m location check, device flag, in-app scanner; college and university only).
- UX pass: collapsible dashboard sections, tables and lists scroll after 4 rows (`lib/autoScroll.js`).

## Goal
The CEO said: work is good, but no step-by-step process, not ready to sell, UI/UX weak.
Make it a paid-pilot-ready product with a strong demo in 7 days. Lead demo type: college.

Three parts: (1) Make it onboardable. (2) Make it process-first (step bar on every process, role home screens). (3) Make it safe to sell.

UX rules: jobs not modules; every screen answers "what next?"; one primary button per screen; same layout and words everywhere; no empty boxes (empty states say what to do); every error says how to fix it.

## Seven processes (each gets a step bar)
- Institute setup: 1 Profile and logo, 2 Academic year, 3 Classes/courses and divisions, 4 Subjects and faculty, 5 Fee heads and plans, 6 Import students and staff, 7 Invite people
- Admissions: Enquiry, Application, Documents checked, Decision, Offer, Enrolment fee, Enrolled ("Enrol" creates student, class, ID card, parent invite)
- Fee cycle: Set up fees, Assign to class, Dues generated, Remind, Collect, Receipt, Day-end summary
- Daily attendance: School: Open register, Mark, Submit. College: Today's lectures, Mark or QR, Review, Submit
- Exams and results: Create exam, Papers and dates, Marks entered, Checked, Published, Report cards
- Parent and student: Invite, First sign-in and consent, My day, Pay, Notices
- Client onboarding (vendor): Create institute, Pick type and modules, Send admin invite, Watch setup progress, 30/60/90-day check

## Five ideas
School Year Journey home; Setup in 30 minutes (wizard, templates, check-before-import, sample-data mode); Your institute your look (logo, colour, name everywhere, /c/yourschool); Parent-first mobile ("My child today", WhatsApp share-link reminders); Next-best-action cards.

## 7-day schedule
- Day 1: shared pieces: step bar, one page header, empty states, consistent tables and forms.
- Day 2: institute setup wizard and client onboarding (logo, colours, year, classes, fee heads, staff/student import).
- Day 3: admissions and fee cycle (receipt with institute logo).
- Day 4: daily attendance, exams, results, report cards.
- Day 5: parent and student home; full phone pass for every role.
- Day 6: paid hosting, own web address, email sender, backup and restore test, parent consent, privacy page, public pricing/demo page, load pilot data.
- Day 7: buffer, walk every role on phone and laptop, all tests, user guide, hand-over note.

## Not this week
Board-format report cards, NAAC/NBA/NIRF, official WhatsApp/SMS, redesign of payroll/hostel/transport/placement/library/asset screens, multi-campus, offline mode, custom report builder, check-in anti-fraud changes.

## Done means
- New person sets up an institute to first marked attendance in under 30 minutes.
- Each role finishes its main job in 3 screens or fewer.
- Every process shows its step bar; no dead ends or big empty boxes.
- Client logo and colours on app, receipts, report cards, ID cards.
- Emails reach a real inbox; backup exists and a restore was tried once.
- Paid hosting, own web address, public pricing and demo page.
- Parent consent recorded; privacy page live.
- All tests pass; full path walked on phone and laptop for every role.

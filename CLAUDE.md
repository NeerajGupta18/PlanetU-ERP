# PlanetU Campus ERP

Multi-tenant Campus ERP (schools, colleges, universities) built by Neeraj for PlanetU Technovision.
Repo: github.com/NeerajGupta18/planetu-erp. Live: https://planetu-erp.onrender.com (Render, auto-deploys from `main`).

## Stack
- Node/Express + PostgreSQL with forced row-level security (RLS)
- React 18 + Vite, npm workspaces (`server`, `client`)
- Android: Capacitor 7 wrapper in `android-app/` (built by GitHub Actions). PWA for iPhone and desktop.
- Render deploy runs `npm run db:migrate && npm start`

## Commands
- Tests: `node --test --test-concurrency=1` (690+ passing; targeted tests while working, full run before merging)
- Demo data: `npm run db:setup` (re-run after tests or e2e to reseed)

## HOW A DAY RUNS (autopilot)
When Neeraj says "begin day N" (or "do day N"), do the whole of that day from the 7-day schedule below. Do not ask for approval at any step. Make reasonable decisions yourself, keep to the day's scope, and finish with a short summary.

1. Start from a fresh main: `git checkout main && git pull`. Create branch `day-N-<short-name>`.
2. Use the `ui-ux-pro-max` skill first for any screen, component or layout work. Keep the style, colours, fonts and spacing chosen on Day 1 and stay consistent across all screens.
3. Build the day's work in small commits with clear messages.
4. When the work is done: run `npm run db:setup`, then the full test suite.
   - If any test fails: fix and re-run. Try up to 3 times. If still failing, do NOT merge: stop, leave the branch pushed, and report exactly what fails.
5. If all tests pass and the day added or changed a database migration: STOP before merging. Push the branch, and tell Neeraj what the migration does so he can say go ahead.
6. If all tests pass and there is no migration: push the branch, open a pull request with `gh pr create`, merge it with `gh pr merge --squash --delete-branch`, then `git checkout main && git pull`.
7. Confirm the deploy: Render auto-deploys from main (usually 1 to 3 minutes). Check the live site with `curl -s -o /dev/null -w "%{http_code}" https://planetu-erp.onrender.com`, retrying every 30 seconds for up to 10 minutes, until it returns 200. If it never does, report it. Do not try to change Render settings.
8. Final summary (short): what was built, tests result, what was merged, deploy status, anything Neeraj should check by hand on his phone.

## Hard limits (never do these, even on autopilot)
- Never push or force-push directly to `main`. Always go through a pull request.
- Never skip or delete tests to make them pass. Never merge with a failing test.
- Never edit Render settings, environment variables, billing, domains or secrets. Never print or commit secrets or `.env` files.
- Never run destructive database commands on anything but local demo data.
- Do not rely on DB migrations updating `tenants` rows on the live host (RLS). Gate features from tenant type or code instead.
- Build on the existing system. No rewrites. Keep all existing tests passing.
- Do not read the whole repo. Look only at the files the day's task needs.
- Documents for his mam: plain simple text PDFs, no dates, modest wording.

## Already built (do not redo)
- QR check-in v2 (rotating signed token, optional 150 m location check, device flag, in-app scanner; college and university only).
- UX pass: collapsible dashboard sections, tables and lists scroll after 4 rows (`lib/autoScroll.js`).
- Day 1 (done and live): shared step bar, one page header, empty states, consistent tables and forms.

## Goal
The CEO said: work is good, but no step-by-step process, not ready to sell, UI/UX weak.
Make it a paid-pilot-ready product with a strong demo in 7 days. Lead demo type: college.

Three parts: (1) Make it onboardable. (2) Make it process-first (step bar on every process, role home screens). (3) Make it safe to sell.

UX rules: jobs not modules; every screen answers "what next?"; one primary button per screen; same layout and words everywhere; no empty boxes (empty states say what to do); every error says how to fix it; works well on a phone.

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
- Day 1 (DONE): shared pieces: step bar, one page header, empty states, consistent tables and forms.
- Day 2: institute setup wizard (7 steps above, with a progress bar) and client onboarding: logo and colours, academic year, classes, fee heads, staff and student import from a sheet with downloadable templates, a "check before import" screen that explains each bad row, sample-data on/off, vendor view of each client's setup progress. Done when: a new institute goes from empty to ready for its first class without help.
- Day 3: admissions board (enquiry to enrolled) and the fee cycle (class-wise dues, concessions, late fees, reminders with a ready message, collection, receipt with the institute logo, day-end summary). Done when: a student is admitted, pays a fee, and the receipt shows the institute's logo.
- Day 4: daily attendance (fewest taps, teacher home = today's lectures) and exams, results, report cards (progress per paper, publish only when complete). Done when: a teacher marks a class in under a minute, and a result is published and printed.
- Day 5: parent and student home ("My child today", fees due with Pay button, attendance, results, notices) and a full phone pass for every role. Done when: a parent finds and pays a fee from a phone in three screens or fewer.
- Day 6 (DO STEP BY STEP WITH NEERAJ, NOT AUTOPILOT): paid hosting, own web address, email sender, backup and restore test, parent consent, privacy page, public pricing and demo page, pilot data.
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

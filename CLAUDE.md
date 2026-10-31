# PlanetU Campus ERP

Multi-tenant Campus ERP (schools, colleges, universities) built by Neeraj for PlanetU Technovision.
Repo: github.com/NeerajGupta18/planetu-erp. Live: https://planetu-erp.onrender.com (Render free plan, auto-deploys from `main`).
Current plan document: https://claude.ai/artifact/PTmh1RaUbUL4TnYS7Fjpd8 (3-day showcase website and AI agents plan).

## Stack
- Node/Express + PostgreSQL with forced row-level security (RLS)
- React 18 + Vite, npm workspaces (`server`, `client`)
- Android: Capacitor 7 wrapper in `android-app/` (built by GitHub Actions). PWA for iPhone and desktop.
- Render deploy runs `npm run db:migrate && npm start`

## Commands
- Tests: `node --test --test-concurrency=1` (750+ passing; targeted tests while working, full run before merging)
- Demo data: `npm run db:setup` (re-run after tests or e2e to reseed)
- Run tests only against this repo's own database. Never use a database or container belonging to another project.

## HOW A DAY RUNS (autopilot)
When Neeraj says "begin day N" (or "do day N"), do the whole of that day from the schedule below. Do not ask for approval at any step. Make reasonable decisions yourself, keep to the day's scope, and finish with a short summary.

1. Start from a fresh main: `git checkout main && git pull`. Create branch `day-N-<short-name>`.
2. Use the `ui-ux-pro-max` skill first for any screen, component or layout work. Keep the style, colours, fonts and spacing from `design-system/planetu-campus-erp/MASTER.md` and stay consistent across all screens.
3. Build the day's work in small commits with clear messages.
4. When the work is done: run `npm run db:setup`, then the full test suite.
   - If any test fails: fix and re-run. Try up to 3 times. If still failing, do NOT merge: stop, leave the branch pushed, and report exactly what fails.
5. If all tests pass and the day added or changed a database migration: STOP before merging. Push the branch, and tell Neeraj in plain words what the migration does so he can say go ahead. Only additive migrations (new tables or columns) are acceptable. If a migration drops, renames or rewrites existing data, say so clearly.
6. If all tests pass and there is no migration: push the branch, open a pull request with `gh pr create`, merge it with `gh pr merge --squash --delete-branch`, then `git checkout main && git pull`.
7. Confirm the deploy: Render auto-deploys from main (usually 1 to 3 minutes). Check the live site with `curl -s -o /dev/null -w "%{http_code}" https://planetu-erp.onrender.com`, retrying every 30 seconds for up to 10 minutes, until it returns 200 and serves the new build. If it never does, report it. Do not try to change Render settings.
8. Final summary (short): what was built, tests result, what was merged, deploy status, anything Neeraj should check by hand on his phone.

## Hard limits (never do these, even on autopilot)
- Never push or force-push directly to `main`. Always go through a pull request.
- Never skip or delete tests to make them pass. Never merge with a failing test.
- Never edit Render settings, environment variables, billing, domains or secrets. Never print or commit secrets, API keys or `.env` files.
- Never run destructive database commands on anything but local demo data.
- Do not rely on DB migrations updating `tenants` rows on the live host (RLS). Gate features from tenant type or code instead.
- Build on the existing system. No rewrites. Keep all existing tests passing.
- Do not read the whole repo. Look only at the files the day's task needs.
- Documents for his mam: plain simple text PDFs, no dates, modest wording.

## Already built and live (do not redo)
- QR check-in v2 (college and university only); collapsible dashboards; tables scroll after 4 rows.
- Day 1: shared step bar, one page header, empty states, consistent tables and forms.
- Day 2: institute setup wizard (7 steps), logo and colour, staff and student import with check-before-import, sample data on/off, vendor view of setup progress.
- Day 3: admissions board, fee cycle (reminders, late fees, concessions, day-end summary), receipts and ID cards with the institute logo.
- Day 4: fast attendance marking, exams checklist and publish-only-when-complete, report cards with logo.
- Day 5: "My child today" parent home, phone pass for every role.
- Day 6A: parent consent record, privacy page (draft), public landing page at `/` (Contact us prices), Book a demo form and vendor Demo requests list, backup and restore scripts.
- Day 7: user guides per role in `docs/guides/`, hand-over note, demo script, phone-width fixes.

## Done by Neeraj on Saturday, NOT by Claude Code
Paid Render hosting, own web address, company email and domain, Brevo email settings, Razorpay keys, pilot institute data. Until then everything runs on the free plan with demo data only.

## NEW PLAN (Days 8 to 10): showcase website and AI agents

### Goal
The first page a client sees must feel premium and prove the product, and the ERP gets AI agents that do real jobs with a person approving every important change. Lead demo type: college.

### Website rules (Day 8)
- Concept: one school year in one scroll, backed by REAL screens captured from the demo institute (laptop and phone widths, logo and colour set). Use the browser to capture them.
- Nine sections: hero with device mockups and sticky "Book a demo"; proof strip of TRUE facts only; the pinned school-year story (Admissions, Fees, Attendance, Exams, Results, Parent); Set up in 30 minutes (auto-playing seven steps); Your role your home (Principal, Accountant, Teacher, Parent tabs); Your institute your look (live colour change); Meet the assistants; Trust; Plans (Contact us), FAQ and the existing demo form.
- Use GSAP and ScrollTrigger for scroll motion; confirm the licence when installing. Motion must add meaning, never noise.
- On phones the pinned story becomes stacked cards with simple fade-ins. For reduced-motion visitors the page is fully static.
- The landing page loads as its own chunk so the ERP bundle does not get heavier. The chat bubble loads only when clicked.
- Targets to measure and report, not assume: usable in about 2 seconds on a mid-range phone over 4G; Lighthouse mobile performance 85 or more.
- NEVER invent client logos, testimonials, user counts, prices or hosting/backup claims. Pricing stays "Contact us". Every claim on the page must be true in the code today.
- Signed-in users still go straight to their home screen. The Android app and installed phone app still open on sign-in.

### Agent rules (Days 9 and 10), these are hard rules
1. Agents run as the signed-in user, through the existing tenant and role checks (RLS). Never use a bypass or service role. An agent can never see another institute's data or do more than that role can.
2. Agents have read tools and ONE write path: creating a proposal. They never change data directly. After a person approves in the approval inbox, the existing app functions apply the change.
3. Agents never touch payments, marks, admission decisions (accept, reject, offer, waiver), deletions, settings or user roles.
4. Text from outside (enquiry forms, uploaded sheets, website chat) is untrusted data. Put it in clearly marked delimiters, tell the model it is data and not instructions, and make sure no tool can be driven by it.
5. The model sees codes and first names only. Phone numbers, emails and addresses never go to the model; the server fills them in at send time.
6. Numbers (amounts, counts, dates, percentages) come from SQL, never from model text. Validate tool inputs in handlers and use strict schemas. Show the figures used on screen.
7. Log every run: who asked, which tools ran, what was proposed, who decided, tokens used. Add a daily token cap per institute. The public chat gets its own tighter cap, a per-connection rate limit, a message length limit and the existing human check before the first message.
8. Model keys come from environment variables: `AGENT_LLM_PROVIDER`, `AGENT_LLM_MODEL`, `AGENT_LLM_API_KEY` for the internal agents, and `PUBLIC_LLM_PROVIDER`, `PUBLIC_LLM_MODEL`, `PUBLIC_LLM_API_KEY` for the public Support Help Agent. Locally they live in `server/.env`, which must be in `.gitignore` (verify with `git check-ignore server/.env`). Never print or commit them. Neeraj creates the keys and adds them to Render himself. With no key, every assistant shows "Not connected" and the rest of the ERP works.
9. FREE MODELS for the demo (Neeraj is not buying an API key). Put ALL model calls behind ONE small adapter (`server/agents/llm.js`) so the provider changes by environment variables only. Use the OpenAI-compatible chat-completions format with tool calling, which Groq and Google's Gemini API both offer; verify in their current docs, do not guess, and confirm the chosen model supports tool calling. Defaults: internal agents on Groq with an open model that supports tool calling (the Groq limits page lists gpt-oss-120b and gpt-oss-20b; confirm current IDs); the public Support Help Agent on a SEPARATE provider and key (Gemini free tier) so a visitor spamming the chat cannot use up the agents' allowance. Keep model names in config.
   - Limits: Groq's limits page lists about 30 requests/min, 1,000 requests/day, 8,000 tokens/min and 200,000 tokens/day for its main models (confirm the free-plan figures in the console). Keep prompts short: compact tool results, a short fact sheet, one drafted template per language instead of one message per person. Set our own caps below the provider limits.
   - On a rate-limit error (HTTP 429) show "The assistant is busy, try again in a minute". Never retry in a tight loop.
   - Privacy: Google says its free tier may use content to improve its products. So demo data only, and only codes and first names ever reach a model. A paid or no-training tier must be in place BEFORE any real pilot data is used.
   - Quality: open models are weaker at multi-step tool use and may be weak in Hindi and Marathi. Keep tools simple, keep numbers from SQL, and let the 20-question test set decide. If Hindi or Marathi replies are poor, fall back to English only and say so in the summary.
10. Tests NEVER call the real API. Use a stub model client. Include a test set of about 20 fixed questions whose answers are checked against the database, and tests with hidden instructions inside an enquiry that must cause no action.
11. Each agent's instructions live in one plain text playbook file in `server/agents/playbooks/`.
12. Add one line about AI assistance to the parent consent screen and the privacy page.

### The six agents
- Ask PlanetU (principal, admin): plain-words questions over the institute's own data, read only, shows the numbers used, plus a one-screen morning brief.
- Fee follow-up (accountant): finds overdue dues, groups by guardian, drafts ONE reminder template per language (English, Hindi or Marathi) with placeholders that our code fills with names and amounts, tracks who paid. Person approves "Send N reminders". Reminders are ready-to-send share links and in-app notices until email is connected.
- Setup fixer (admin): cleans a messy student or staff sheet (column matching, phone formats, name casing, duplicates), explains each fix, imports only after approval.
- Attendance watch (class teacher, principal): flags three absences in a row or a student near the minimum percentage, drafts a parent note, teacher approves.
- Admissions helper (admission office): checks an enquiry for missing documents, finds duplicates, drafts the reply and suggests the next step. Every decision stays human.
- Support Help Agent (public chat bubble on the landing page): an AI-labelled assistant that answers from one plain-text fact sheet (written from the real user guides), offers quick-question buttons, books a demo into Demo requests, or leaves a message for the team. Hands over at once if asked for a person, after two unhelpful answers in a row, and for prices, contracts, refunds or personal data. Never quotes a price. Replies in English, Hindi or Marathi. No login, no student data. It only ever does two things: book a demo or leave a message. Stretch only if time is left: the same engine as a Help bubble inside the ERP for signed-in staff, answering how-to questions from the in-app guides with no access to school data.

Stretch ideas, only if everything else is done: report-card remarks drafter (teacher edits), read-only MCP connection.
Not in these days: scheduled morning runs (needs the paid always-on server), automatic WhatsApp or SMS sending, real student data, heavy 3D or WebGL.

### Schedule
- Day 8 (Tue 27 Oct) showcase website: the nine sections above, real captured screens, phone and reduced-motion versions. Done when: the pinned story runs smoothly on a laptop, stacks cleanly on a phone, and Book a demo still lands in Demo requests. No migration expected.
- Day 9 (Wed 28 Oct) agent foundation and three agents: approval inbox page; proposal and audit tables (migration, so STOP for go-ahead); permission-checked tool layer; Ask PlanetU with morning brief; Fee follow-up; Setup fixer. Done when: "Which classes had the lowest attendance this week?" gives an answer matching the database, "Send N reminders" is prepared and waits, and a messy sheet comes out clean.
- Day 10 (Thu 29 Oct) three more agents and safety: Attendance watch; Admissions helper; Support Help Agent bubble on the landing page (may need a small additive migration, STOP for go-ahead); the 20-question test set; hidden-instruction tests; the AI line on consent and privacy; update the user guides and demo script. Done when: all tests pass, a hidden-instruction enquiry produces only a draft, the Support Help Agent answers five fact-sheet questions correctly, says it does not know otherwise, and books a demo into Demo requests.
- Fri 30 Oct: buffer, phone walk of every new screen, full demo rehearsal. Sat 31 Oct: office visit.

## Done means (new plan)
- Landing page tells the school-year story with real screens, is quick on a phone, and is static for reduced motion.
- Nothing on the site is untrue: no invented logos, testimonials, counts or prices.
- Ask PlanetU answers the 20 test questions with numbers matching the database.
- Fee follow-up sends nothing without an approval click.
- Setup fixer imports only after approval.
- Attendance watch and Admissions helper produce drafts only.
- Support Help Agent answers only from its fact sheet, says when it does not know, is labelled as AI, and can only book a demo or leave a message.
- A hidden-instruction test causes no action.
- Every agent action appears in the approval inbox and the audit log.
- Without an API key the assistants say "Not connected" and the rest of the ERP works.
- All tests pass; every new screen walked on a phone and a laptop; demo script includes the new parts.

## Local database safety
- This repo's local database is on port 5433. Before running `npm run db:setup` or any test, confirm DATABASE_URL points to localhost:5433 and this repo's own database. If it points anywhere else, stop and tell Neeraj.
- Day 10: when the assistants are live, remove the "Coming soon" label from the assistants section of the landing page.

## Day 11: reverted
Day 11 (fingerprint login) was reverted; fingerprint login is not part of the product. Migration 033_trusted_devices.sql and its unused table stay as they are (already applied on the live database).

## Day 12 (Sat 31 Oct): parent privacy fix, KPIs, best dashboards, 360-degree device viewer
Day 11 fingerprint login is not part of the product (reverted).

### How Day 12 runs (overrides the one-branch-per-day rule)
Split Day 12 into SEPARATE branches and pull requests, in this order. For each one: branch, build, full tests, PR, merge, confirm the deploy, then start the next. Never bundle them, so any one can be reverted alone. The live site must be in a working state after every merge. If time runs short, stop after any merged PR and report what is left.
- 12A parent privacy fix (do this FIRST and merge it before anything else)
- 12B shared dashboard kit and the Institute Admin dashboard
- 12C parent dashboard
- 12D 360-degree device viewer on the landing page
- 12E super admin dashboard
- 12F employee dashboard (teacher and staff)
- 12G student dashboard
Standing rules still apply: stop for any migration (additive only; prefer NO migration and compute from existing tables), never touch Render settings, never skip or loosen tests.

### 12A Parent privacy fix (security bug, highest priority)
Bug reported by Neeraj's sir: signed in as a parent, an option appears to view another child who belongs to a different parent. A parent must see ONLY their own children.
1. Diagnose first and say which it is, with evidence. Check all four: (a) wrong guardian-student links in the data or the seed (for example demo parent PAR001 linked to a child of another family); (b) the child switcher listing students by something other than the guardian link; (c) client state leaking between sessions (a selected-child id or cached data left in browser storage or memory after a different user signed out); (d) a server endpoint that returns another student's data when given their id.
2. If the cause is seed data, fix the seed so every demo parent sees only their own children. Keep ONE demo family with two real siblings (same guardian record) so the child switcher can still be demonstrated, and name it in the summary.
3. Fix the real cause on the server, not only on screen. Every parent-facing endpoint (dashboard, fees, receipts, attendance, results, report card and ID card PDFs, timetable, notices, notifications, payments, anything taking a student id) must check the guardian-student link for the signed-in user and return 404 or 403 for any other student, with no data in the error.
4. Sibling links come only from explicit guardian-student link rows created or approved by the office. Never match parents and children by name, phone or email coincidence at read time.
5. On sign-out and on sign-in, clear all per-user client state (selected child, cached queries, stored ids).
6. Audit: list every API route that accepts a student, employee or institute id and state how each is protected. Fix any other route that lets one user read another user's data within the same role, and report each one found. If a finding needs a bigger change, report it instead of guessing.
7. Tests: parent A can list and open only A's children; parent A requesting parent B's child on EVERY parent endpoint gets 403 or 404 and no data; the child switcher lists only linked children; two parents with the same surname or phone digits stay separate; student A cannot read student B; a class teacher sees only their own class; another institute's ids return nothing. These tests must fail on the old code.

### 12B Shared dashboard kit and Institute Admin dashboard
Principle: the dashboard is the best page of each role. Neeraj's sir could not see the most important facts on the admin dashboard. Build ONE shared kit first and use it for all five dashboards.
Kit:
- KpiCard: big value, label, change versus the previous period with an up or down arrow and a colour that says whether the change is good or bad (more absentees is bad), a small sparkline, a one-line meaning on hover, a click-through to the detail page, and loading, empty and error states (the error says how to fix it). Indian number grouping and the rupee sign (for example ₹33,07,500); on small cards a compact form (for example ₹33.1 L) with the full value in the title.
- Lightweight custom SVG charts: sparkline, ring, bar, stacked bar, trend line, heatmap, funnel. No heavy chart library unless you measure it and can justify it. Every chart has an aria-label and a visually hidden data table, uses the institute colour and design tokens, and shows a helpful empty state when there is too little data.
- A data freshness line ("Updated 10:42") and a refresh button.
- One server endpoint per role, aggregated in few queries, scoped by institute and role, with a short cache (60 seconds at most, never shared between users or institutes). Report the response time and the bundle size change.
Institute Admin dashboard, in this order (use the institute's own words: school = classes and divisions; college = programs, departments and divisions; university = faculties and departments):
1. At a glance: total students (with new this month and active), total employees split into faculty and non-teaching staff, departments (or classes), divisions, programs or courses.
2. Money: fees collected today, this month and this year; fees outstanding and overdue; collection rate (collected divided by billed); a 6-month collected-versus-billed chart.
3. Attendance: students present today against last week; 14-day trend; lectures not marked today; students below 75%; staff attendance today if the data exists.
4. Academics: exams awaiting marks or publishing; average and pass percentage for the latest published exam; department comparison.
5. Decisions: leave and other approvals waiting, new enquiries, applications by stage as a funnel.
6. Department heatmap: departments by attendance, fee collection and results, click to drill into the department.
7. Unique feature (flagship): the Year Journey. A strip across the top showing the academic year from start to end with today marked and the stages Admissions, Fees, Timetable, Attendance, Exams, Results, Certificates, each with a status (not started, in progress, done), one number that matters and a button for the next action. Beside it an Institute Pulse score from 0 to 100 made from attendance, fee collection, pending approvals and exam completion, with the formula one click away and the biggest change since yesterday. Optional small extra: an "Ask PlanetU" box that opens the Assistants page with the question filled in.
Every number must reconcile with its detail page: total students equals the Students page count, fees collected equals the Fees page and the day-end summary, attendance equals the Attendance page. Add reconciliation tests that compare the dashboard figures with the detail endpoints.

### 12C Parent dashboard
Only the signed-in parent's own children (see 12A). Per child: today's classes status, attendance percentage with a 30-day trend, fees due with a Pay button and the last receipt, latest result with a marks trend, upcoming exams, notices. Flagship: the What-if meter: "If my child misses N more classes, attendance becomes X%", with a slider, computed from the real counts and the institute's minimum percentage. The child switcher shows only if more than one linked child.

### 12D 360-degree device viewer (landing page)
Neeraj wants the laptop and phone mockups on the landing page to rotate a full 360 degrees for a premium feel.
- One reusable DeviceViewer component with a laptop and a phone variant, used everywhere a device frame shows (hero, role tabs, the setup story and any other).
- Pure CSS 3D transforms with pointer events, no WebGL and no 3D library. The device has a front (the real screenshot), sides and a back (the PlanetU mark on the laptop lid; a plain back with a camera block on the phone).
- Drag or swipe to spin a full 360 degrees around the vertical axis, with a little inertia; tilt up and down limited to about 25 degrees. A "Drag to rotate" hint that disappears after the first drag. Double click or double tap resets. Arrow keys rotate it when focused, with an aria-label explaining that.
- On phones use touch-action pan-y so vertical scrolling still works and a horizontal swipe spins the device. It must never trap the page scroll.
- Gentle idle sway until the first interaction. For reduced-motion visitors there is no sway or inertia; manual rotation still works. Pause everything when off screen (IntersectionObserver).
- It must not fight the pinned GSAP story. Reserve the size so nothing jumps (no layout shift).
- Test in WebKit (Safari) as well as Chromium, because Neeraj uses Safari and preserve-3d and backface-visibility behave differently there. Report Lighthouse mobile performance and layout shift before and after.

### 12E Super admin dashboard (platform owner)
KPIs: institutes by type and status; total students and employees across all institutes (counts only); average setup completion; institutes stuck on a setup step; institutes with no activity in 7 days; 30, 60 and 90-day checks due; demo requests (new, contacted, closed) and chat messages waiting; assistant usage against the daily caps. Charts: setup progress per institute, new institutes over time, demo request funnel. Flagship: the Client health board, one row per institute with a green, amber or red flag and the reason.

### 12F Employee dashboard (teacher and staff)
Today's lectures as a timeline with a countdown to the next one and a one-tap Mark button; marks entry progress per paper; leave balance and status; my attendance if available; students who need a call (from Attendance watch); approvals if the role has them. Flagship: the My Day timeline. Class teachers see only their own class.

### 12G Student dashboard
Attendance ring with per-subject bars and the same What-if meter; fees due and paid; exam countdown; latest results with a marks trend; today's timetable; coursework due; notices.

### Demo data, honesty and checks for all of Day 12
- Charts need history. Check the local demo seed has about 30 to 60 days of attendance, monthly fee payments and exam results across several departments, and improve the seed if not. The live demo data does NOT reseed by itself, so live charts may look thin. In the summary tell Neeraj exactly what he would have to do on Render to refresh the live demo data and exactly what it would delete. Do NOT change Render settings. Make every chart look sensible with short history.
- Never invent numbers on a dashboard. Every figure comes from the database.
- For each of the five dashboards sign in as a real demo user of that role and take screenshots at 390, 768 and 1366 px. No sideways scrolling, targets at least 44 px, zero console errors or warnings, a sensible keyboard focus order, text contrast at least 4.5 to 1.
- Use the ui-ux-pro-max skill for layout, colour, typography and chart rules, and keep to design-system/planetu-campus-erp/MASTER.md and the institute colour.
- Update the user guides, the demo script and the in-app How to use pages for what changed.
- Final summary per PR: what changed, tests, reconciliation results, timings and bundle sizes, anything still untested, and a short phone and laptop checklist for Neeraj.

## Day 13 (Sat 31 Oct): iPhone and Safari support, install page, iOS app project
Goal: the ERP must install and work properly on iPhone through Safari (free, no Apple account), and the repo must contain an iOS app project (Capacitor) that Neeraj can build on his Mac and run on his own iPhone. Today the install prompt asks iPhone users to open Chrome; that must go.

### How Day 13 runs
Three separate branches and pull requests, each with full tests, merge and a deploy check, in this order: 13A, 13B, 13C. Standing rules apply: no migrations, never touch Render settings, never skip tests, never ask for or store Apple ID, passwords or certificates, never spend money.
Honest limits to keep in mind and to repeat in the final summary:
- Real Safari "Add to Home Screen" cannot be automated. Test with Playwright WebKit using an iPhone device profile and say plainly that real-device checks are left to Neeraj.
- A downloadable iOS app for other people needs the paid Apple Developer Program (about 99 USD a year). Do NOT try to work around this. The free route is: build on Neeraj's own Mac with Xcode and a free Apple ID and run on his own iPhone (the install expires after 7 days and must be re-run). Say this in the guide.

### 13A Safari and iPhone install experience (web app)
1. Find the current install prompt code (the one that asks to open Chrome). It likely depends on the beforeinstallprompt event, which Safari never fires. Replace it with a small platform-aware component:
   - iPhone or iPad Safari (and Chrome, Edge or Firefox on iOS, which are also WebKit): show a clear "Install on iPhone" sheet with the real steps: tap the Share button, choose Add to Home Screen, tap Add. Include a simple drawing of the Share icon. No wording about Chrome.
   - Android Chrome: keep the existing one-tap install.
   - Desktop: keep what exists; Safari on Mac can use File, Add to Dock, so show that hint.
   - Already running as an installed app (display-mode standalone, or navigator.standalone on iOS): show nothing.
   - Dismissal remembered for 14 days in localStorage wrapped in try/catch. Never block the page.
2. Detect the platform in one small tested helper (user-agent plus touch points, because iPadOS reports as Mac). Unit tests with real iPhone Safari, iPhone Chrome, iPad, Android Chrome, Mac Safari and desktop Chrome user-agent strings.
3. The prompt must never appear on the login screen in a way that covers the form on a 390 px phone, and must not hurt the landing page Lighthouse score. Lazy-load it.

### 13B iOS web app correctness (installed and in-browser)
Check and fix each item, and report what was already fine:
- index.html and manifest: apple-touch-icon 180x180 (PNG, no transparency), apple-mobile-web-app-capable, apple-mobile-web-app-title, apple-mobile-web-app-status-bar-style, theme-color, viewport-fit=cover, manifest name, short_name, start_url, scope, display standalone, 192 and 512 icons plus a maskable icon.
- Safe areas: use env(safe-area-inset-top, bottom, left, right) for the header, bottom nav, floating buttons and chat bubble so nothing hides behind the notch or the home bar. Use 100dvh (with a fallback) instead of 100vh.
- Inputs: font-size at least 16 px so iOS Safari does not zoom on focus; check date, select and file inputs.
- Standalone mode has no browser back button: make sure every screen has an in-app way back, and the app does not leave the installed window for internal links. External links open in the system browser.
- Sign-in: installed iPhone web apps have their own storage, separate from Safari. Confirm login, session refresh and sign-out all work inside the installed app, and that a session survives closing the app. Fix anything that depends on third-party cookies.
- Service worker and offline: confirm it registers on Safari and the app shell loads without error; no feature may assume Chromium-only APIs. List any Chromium-only API found (for example the Badging API, background sync, beforeinstallprompt) and guard each one.
- QR check-in scanner (camera) and file uploads: confirm they work in iOS Safari and installed mode, or show a clear message with what to do.
- The 360-degree device viewer and dashboards: re-check in WebKit at iPhone sizes (390x844, 430x932) and iPad (820x1180). No sideways scroll, targets at least 44 px, zero console errors.
- Add Playwright WebKit tests using the iPhone 14 and iPad device profiles that open the landing page, the login page and one dashboard per role, and assert: no horizontal overflow, the install sheet shows the iPhone steps (and no Chrome wording), nothing is hidden by safe-area padding (test by emulating insets), and zero console errors.

### 13C iOS app project (Capacitor) for Neeraj's own iPhone
1. Check the existing Capacitor 7 Android setup in android-app/ and reuse the same web build and config approach. Add the iOS platform the same way the repo already does Android, with @capacitor/ios at the same major version as the other Capacitor packages. Put it in ios-app/ (or the repo's convention; say which).
2. Check what Neeraj's Mac has: Xcode, command line tools, and CocoaPods (or Swift Package Manager if the Capacitor version uses it). If something is missing, STOP that sub-step, list the exact commands Neeraj must run himself, and continue with the parts that do not need it. Do not install system-wide software without saying so first.
3. Configure: app id matching the Android one, app name PlanetU Campus ERP, iPhone icon set and launch screen from the existing brand assets, status bar, safe areas, allowed navigation to the live site only, camera usage description text (needed for QR check-in) in Info.plist, and no tracking.
4. Decide with evidence whether the app should bundle the web build or load the live site (the Android app's approach is the default to match). Say which and why.
5. Do NOT add Face ID or fingerprint login (Day 11 was reverted).
6. Do not commit signing certificates, provisioning profiles, Apple IDs or team ids. Add the right ignore entries (Pods, DerivedData, xcuserdata, build output).
7. Optional GitHub Actions job on a macOS runner that only builds for the iOS simulator without signing, to catch breakage. If the free runner minutes are a concern, skip it and say so.
8. Write docs/guides/ios-app.md in plain simple words, aimed at Neeraj: how to open the project in Xcode, choose his free Apple ID under Signing, plug in the iPhone, enable Developer Mode on the phone, press Run, trust the developer profile in Settings, and what to do when it expires after 7 days. Also a short section "Giving the app to other people" explaining that this needs the paid Apple Developer Program and TestFlight, and that until then clients use Add to Home Screen.

### 13D Install page and landing links
1. Add a public /install page and a "Get the app" section or button on the landing page with three clearly separated cards: Android (the APK download that already exists), iPhone and iPad (Add to Home Screen steps, same component as 13A), Computer (install from Chrome or Edge, or Add to Dock in Safari). Auto-highlight the card for the visitor's device.
2. On wide screens show a QR code that opens /install on the phone. Generate it without a heavy library (a small inline generator, or a static SVG made at build time) and report the size added.
3. Keep the landing page mobile Lighthouse performance no lower than before (it is 75 now) and layout shift near 0; report before and after.
4. Update the user guide, the demo script and the in-app How to use page.

### Done means for Day 13
- Opening the site in iPhone Safari shows iPhone install steps, never "open Chrome".
- After Add to Home Screen the app opens full screen with the right icon and name, nothing hidden by the notch or home bar, sign-in works and stays signed in.
- ios-app/ exists, syncs with the web build, and the guide lets Neeraj run it on his own iPhone.
- All tests pass, including the new WebKit iPhone tests. No migrations.
- Final summary per PR: what changed, tests, what could NOT be tested without a real iPhone, and a short checklist for Neeraj on the iPhone: install from Safari, open from the home screen, sign in as each role, scan a QR check-in, upload a file, close and reopen the app.

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
8. The API key comes from the `ANTHROPIC_API_KEY` environment variable. Locally it lives in `server/.env`, which must be in `.gitignore` (verify). Never print or commit it. Neeraj adds it to Render himself. Without a key every assistant shows "Not connected" and the rest of the ERP works.
9. Use the official Anthropic Node SDK. Keep model names in one config file: the small model (Haiku 5.5) for drafting and sorting, Sonnet 5.5 for Ask PlanetU. Confirm exact model IDs from the official docs when installing; do not guess.
10. Tests NEVER call the real API. Use a stub model client. Include a test set of about 20 fixed questions whose answers are checked against the database, and tests with hidden instructions inside an enquiry that must cause no action.
11. Each agent's instructions live in one plain text playbook file in `server/agents/playbooks/`.
12. Add one line about AI assistance to the parent consent screen and the privacy page.

### The six agents
- Ask PlanetU (principal, admin): plain-words questions over the institute's own data, read only, shows the numbers used, plus a one-screen morning brief.
- Fee follow-up (accountant): finds overdue dues, groups by guardian, drafts reminders in English, Hindi or Marathi, tracks who paid. Person approves "Send N reminders". Reminders are ready-to-send share links and in-app notices until email is connected.
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

#!/usr/bin/env bash
# Creates a clean, feature-by-feature Git history for this project and (optionally) pushes it to GitHub.
#
# A. A NEW, EMPTY repository:
#      bash scripts/git-history.sh git@github.com:YOU/planetu-erp.git
#
# B. A repository that ALREADY has earlier work (your old commits are kept, the new commits go on top):
#      git clone git@github.com:YOU/planetu-erp.git planetu-merge && cd planetu-merge
#      (optional, safest) git checkout -b complete-system     # review on GitHub before touching main
#      find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +    # empty the folder (keeps .git and your history)
#      cp -R /path/to/new/planetu-erp/. .                                  # put the new project files in
#      bash scripts/git-history.sh --existing                              # on a branch: review the summary, answer y
#      bash scripts/git-history.sh --existing --allow-main                 # straight onto main (it will ask you to confirm)
#    Without --allow-main it refuses to run on main/master. On a branch, open a Pull Request on GitHub, review
#    "Files changed", and merge with "Create a merge commit" (not "Squash", which would merge all commits into one).
#
# Each commit adds one feature's files (server, database migration, web screens and tests together) with a
# "Conventional Commits" message. The files are the FINAL versions, so this is an organised history of the
# system's features, not a replay of every edit made while building it. Nothing secret is ever added:
# .gitignore keeps .env files, keys, uploads and node_modules out, and the script double-checks that at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

EXISTING=0; YES=0; ALLOW_MAIN=0; REMOTE=""
for a in "$@"; do
  case "$a" in
    --existing) EXISTING=1 ;;
    --yes) YES=1 ;;
    --allow-main) ALLOW_MAIN=1 ;;
    -*) echo "Unknown option: $a"; exit 1 ;;
    *) REMOTE="$a" ;;
  esac
done

HAS_COMMITS=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ -n "$(git log --oneline -1 2>/dev/null || true)" ]; then HAS_COMMITS=1; fi

[ -n "$(git config user.name || true)" ] && [ -n "$(git config user.email || true)" ] || {
  echo 'Tell Git who you are first:'; echo '  git config --global user.name  "Your Name"'; echo '  git config --global user.email "you@example.com"'; exit 1; }

if [ "$EXISTING" = 1 ]; then
  [ "$HAS_COMMITS" = 1 ] || { echo "--existing needs a clone of your existing repository (this folder has no commits)."; exit 1; }
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  case "$BRANCH" in
    main|master|HEAD)
      if [ "$ALLOW_MAIN" != 1 ]; then
        echo "You are on '$BRANCH'. Either work on a separate branch, so '$BRANCH' stays untouched until you have reviewed it:"
        echo "  git checkout -b complete-system"
        echo "or, if you are sure, commit straight onto '$BRANCH' (your old commits stay in the history):"
        echo "  bash scripts/git-history.sh --existing --allow-main"; exit 1
      fi
      [ "$BRANCH" != HEAD ] || { echo "You are not on a branch (detached HEAD). Run: git checkout main"; exit 1; } ;;
  esac
  CHANGES="$(git status --porcelain -uall)"
  [ -n "$CHANGES" ] || { echo "Nothing to commit: copy the new project files into this folder first (see the instructions at the top of this script)."; exit 1; }
  ADDED=$(printf '%s\n' "$CHANGES" | grep -c '^??' || true)
  DELETED=$(printf '%s\n' "$CHANGES" | grep -cE '^( D|D )' || true)
  CHANGED=$(printf '%s\n' "$CHANGES" | grep -cE '^( M|M |MM)' || true)
  echo "On branch '$BRANCH', on top of $(git rev-list --count HEAD) existing commit(s)."
  echo "This will commit: $ADDED new file(s), $CHANGED changed file(s), $DELETED file(s) removed."
  if [ "$DELETED" -gt 0 ]; then
    echo "Files that exist in your old repository but NOT in the new project (they will be removed on this branch):"
    printf '%s\n' "$CHANGES" | grep -E '^( D|D )' | sed 's/^...//' | head -40 | sed 's/^/   - /'
    [ "$DELETED" -gt 40 ] && echo "   ... and $((DELETED - 40)) more"
    echo "If any of these is work you want to keep, stop now (answer n) and copy it into the folder first."
  fi
  if [ "$YES" != 1 ]; then
    if [ -t 0 ]; then read -r -p "Continue? [y/N] " ans; [ "$ans" = y ] || [ "$ans" = Y ] || { echo "Stopped. Nothing was changed."; exit 1; }
    else echo "Not interactive: add --yes to continue."; exit 1; fi
  fi
else
  [ "$HAS_COMMITS" = 0 ] || {
    echo "This folder already has commits. Two options:"
    echo "  - a new, empty repository: run this on a fresh copy (or delete the .git folder first)"
    echo "  - build on your existing repository: see 'B' at the top of this script (use --existing)"; exit 1; }
  git init -q -b main 2>/dev/null || { git init -q; git checkout -q -b main; }
fi

# add <path-or-glob>...  : stage whatever exists (a missing path is not an error)
add() { local p; for p in "$@"; do if compgen -G "$p" >/dev/null; then git add -- $p; fi; done; }
# commit "<subject>" "<body>" : commit what is staged; skip quietly if nothing is
n=0
commit() {
  if git diff --cached --quiet; then echo "  (skipped, nothing to commit: $1)"; return; fi
  git commit -q -m "$1" -m "$2"; n=$((n+1)); printf '  %2d. %s  [%s files]\n' "$n" "$1" "$(git show --stat --format= HEAD | tail -1 | awk '{print $1}')"
}

echo "Creating commits..."

add .gitignore package.json package-lock.json docker-compose.yml server/package.json server/.env.example \
    client/package.json client/vite.config.js client/index.html client/public
commit "chore: set up the npm workspace, tooling and .gitignore" \
"- npm workspaces: server (Express API) and client (React + Vite)
- docker-compose for a local PostgreSQL
- .gitignore keeps secrets, uploads and build output out of Git"

add server/migrations/001_multi_tenant_core.sql server/src/app.js server/src/server.js server/src/config server/src/middleware \
    server/src/utils server/src/db/pool.js server/src/db/migrate.js server/src/db/repo.js server/src/db/audit.js server/src/db/series.js \
    server/src/routes/wrap.js server/test/isolation.test.js
commit "feat(core): multi-tenant foundation with PostgreSQL Row Level Security" \
"- one database, many institutes: every table carries tenant_id and RLS is forced
- request-scoped transactions, audit log, numbering series, module registry
- restricted app role so a bug cannot read across institutes
- tests prove one institute can never see another's data"

add client/src/App.jsx client/src/main.jsx client/src/components/layout client/src/components/ui/BrandMark.jsx \
    client/src/components/ui/Feedback.jsx client/src/components/ui/Modal.jsx client/src/components/ui/Ui.jsx client/src/config \
    client/src/hooks client/src/pages/ComingSoon.jsx client/src/pages/NotFound.jsx client/src/styles \
    client/src/utils/billing.js client/src/utils/csv.js client/src/utils/dates.js client/src/utils/eventTypes.js client/src/utils/exams.js
commit "feat(web): React app shell with routing, layout, menus and shared UI components" \
"- role-based menus gated by the modules each institute has switched on
- shared components (cards, badges, tabs, modal, loading and error states), theming and date helpers
- mobile-friendly layout"

add server/migrations/004_accounts_notifications.sql server/src/services/accounts.service.js server/src/services/captcha.service.js \
    server/src/services/notifications.service.js server/src/mail server/src/controllers/auth.controller.js server/src/routes/auth.routes.js \
    server/test/accounts.test.js client/src/pages/Login.jsx client/src/pages/ChangePassword.jsx client/src/pages/ForgotPassword.jsx \
    client/src/pages/ResetPassword.jsx client/src/components/auth client/src/context client/src/api
commit "feat(auth): sign-in, sessions, human check, password reset and email queue" \
"- admin, employee, student and vendor sign-in with signed cookie sessions
- forced password change for temporary passwords; reset links by email
- built-in human check (or Google reCAPTCHA); brute-force throttling
- email outbox with retries; tests cover the flows"

add server/migrations/002_files.sql server/src/services/files.service.js server/src/controllers/files.controller.js \
    server/src/routes/files.routes.js server/src/storage/local.js server/src/storage/index.js server/test/files.test.js
commit "feat(files): safe document uploads" \
"- PDF, PNG and JPEG only, identified by their bytes (names and declared types are ignored)
- 5 MB limit, per-institute storage keys, access limited to the uploader and the institute admin
- files open inline for viewing; downloading is an explicit option"

add server/migrations/003_admissions.sql server/src/services/admissions.service.js server/src/controllers/admissions.controller.js \
    server/src/controllers/publicAdmissions.controller.js server/src/routes/public.routes.js server/test/admissions.test.js \
    client/src/pages/public client/src/pages/admin/Admissions.jsx client/src/components/admissions
commit "feat(admissions): public application form and review workflow" \
"- applicants apply and upload documents without an account
- admins verify or reject each document, then accept, waitlist, reject or enrol
- enrolling creates the student record and login"

add server/migrations/005_students_id_cards.sql server/src/services/students.service.js server/src/services/idcard.service.js \
    server/src/services/tenant.service.js server/src/services/timetable.service.js server/src/controllers/students.controller.js \
    server/src/controllers/student.controller.js server/src/controllers/admin.controller.js server/src/routes/admin.routes.js \
    server/src/routes/student.routes.js server/src/routes/employee.routes.js server/test/students.test.js \
    client/src/pages/admin/Students.jsx client/src/pages/admin/Institute.jsx client/src/pages/admin/Departments.jsx \
    client/src/pages/admin/Employees.jsx client/src/pages/admin/Calendar.jsx client/src/pages/admin/Dashboard.jsx \
    client/src/pages/admin/Timetable.jsx client/src/pages/student client/src/pages/employee/Dashboard.jsx
commit "feat(students): student records, ID cards, timetable, calendar and role dashboards" \
"- student and employee management, departments, designations, institute profile
- printable ID cards, timetable with lecture reassignment, academic calendar
- dashboards for admin, employee and student"

add server/migrations/006_fees_library_assets.sql server/src/services/fees.service.js server/src/services/receipt.service.js \
    server/src/services/library.service.js server/src/services/assets.service.js server/src/controllers/fees.controller.js \
    server/src/controllers/library.controller.js server/src/controllers/assets.controller.js server/test/fees.test.js \
    server/test/library.test.js server/test/assets.test.js client/src/pages/admin/Fees.jsx client/src/pages/admin/Library.jsx \
    client/src/pages/admin/Assets.jsx client/src/components/fees
commit "feat(fees,library,assets): fee collection with receipts, library and asset registers" \
"- fee structures, dues, payments, concessions and PDF receipts
- library catalogue with issue and return; institute asset register"

add server/migrations/007_online_payments.sql server/src/services/razorpay.service.js server/src/services/onlinePayments.service.js \
    server/src/controllers/onlinePayments.controller.js server/test/onlinePayments.test.js
commit "feat(payments): online fee payment with Razorpay" \
"- orders for exactly the amount due, signed-payment verification and webhooks
- safe against double payment and amount mismatch; the gateway is mocked in tests"

add server/migrations/008_attendance.sql server/src/services/attendance.service.js server/src/controllers/attendance.controller.js \
    server/test/attendance.test.js client/src/pages/admin/Attendance.jsx client/src/pages/employee/Attendance.jsx \
    client/src/pages/shared/MarkAttendance.jsx client/src/components/attendance
commit "feat(attendance): daily and subject-wise attendance" \
"- faculty mark attendance for the lectures they teach; admins can correct it
- students see their own percentage with shortage warnings"

add server/migrations/009_exams.sql server/src/services/exams.service.js server/src/services/grading.js server/src/services/reportcard.service.js \
    server/src/controllers/exams.controller.js server/test/exams.test.js client/src/pages/admin/Exams.jsx client/src/pages/admin/ExamDetail.jsx \
    client/src/pages/employee/Exams.jsx client/src/pages/shared/EnterMarks.jsx
commit "feat(exams): exams, marks entry, grading scale, GPA and report cards" \
"- exam papers per subject, marks entry by the teacher who teaches it
- configurable grading scale, GPA, publishing of results, report card PDFs"

add server/src/services/studentImport.service.js server/src/services/xlsx.js server/src/services/zip.js server/src/services/tablepdf.js \
    server/src/services/reports.service.js server/src/controllers/reports.controller.js server/test/studentImport.test.js \
    server/test/reports.test.js client/src/pages/admin/Reports.jsx client/src/pages/admin/StudentImport.jsx
commit "feat(reports): bulk student import and a reports hub with Excel, PDF and CSV export" \
"- CSV import with row-by-row validation before anything is saved
- reports for students, staff, fees, attendance and exams; in-house Excel writer"

add server/migrations/010_vendor_billing.sql server/src/services/billing*.js server/src/services/invoicepdf.service.js \
    server/src/controllers/billing.controller.js server/src/controllers/superadmin.controller.js server/src/routes/superadmin.routes.js \
    server/test/billing.test.js client/src/pages/superadmin client/src/pages/admin/Billing.jsx client/src/components/billing
commit "feat(billing): charge institutes a subscription with GST invoices" \
"- plans, trials, recurring invoices, reminders, grace period and access pause
- GST tax invoice PDFs (CGST/SGST or IGST), Razorpay payment, offline payment recording
- vendor console: revenue, receivables, institutes, price list"

add server/migrations/011_learning_quizzes.sql server/src/services/learning.service.js server/src/services/quiz.service.js \
    server/src/services/quizGrading.js server/src/services/teaching.service.js server/src/controllers/learning.controller.js \
    server/src/controllers/quiz.controller.js server/test/learning.test.js server/test/quizzes.test.js client/src/utils/learning.js \
    client/src/pages/shared/LearningManage.jsx client/src/pages/shared/LearningAssignment.jsx client/src/pages/shared/QuizManage.jsx \
    client/src/pages/shared/QuizEditor.jsx client/src/pages/shared/QuizResults.jsx
commit "feat(learning,quizzes): MOOC credits and timed quizzes for internal marks" \
"- assign NPTEL/SWAYAM/in-house courses to a class and subject for compulsory credits
- certificate submission and approval, or automatic completion by lessons
- timed auto-graded quizzes; the server owns the clock and the answer key
- internal marks scaled to each quiz's weightage"

add client/src/components/ui/DocumentViewer.jsx
commit "feat(admissions): review documents on screen instead of downloading them" \
"- on-page viewer with Verify and Reject beside the document, previous/next navigation
- PDFs are allowed to display (the old header blocked Chrome's PDF viewer)"

add server/src/db/seed.js server/src/db/seed-cli.js server/src/db/demo-data.js
commit "feat(demo): sample institutes with realistic data" \
"- three demo institutes (school, college, university) for trying every role
- the seed refuses to run in production (it uses published demo passwords)"

add server/src/db/vendor.js server/src/db/create-vendor-cli.js server/test/vendor.test.js server/test/migrate.test.js deploy DEPLOY.md
commit "feat(deploy): production setup for a Linux server (Oracle Cloud guide)" \
"- npm run create-vendor makes the platform-owner account with a strong password
- migrations work for a limited database owner and can be repeated safely
- systemd service, Caddy HTTPS config, backup and update scripts, DEPLOY.md"

add server/migrations/012_file_blobs.sql server/src/storage/db.js server/test/storage.test.js render.yaml RENDER.md scripts
commit "feat(render): run on Render's free tier" \
"- uploaded files can be kept inside PostgreSQL (STORAGE_DRIVER=db) because the disk is wiped on restart
- single-account database mode (DB_SINGLE_ROLE) with Row Level Security still forced
- owner account created from environment settings (no shell on the free tier)
- Render Blueprint (render.yaml) and RENDER.md step-by-step guide"

add README.md
commit "docs: README with setup, features, API and deployment overview" \
"- how to run locally, roles and demo logins, module list, API reference, deployment options"

# Anything not matched above (so no file is ever left out), including files removed from an older version
git add -A
if git diff --cached --name-status | grep -q '^D'; then
  commit "chore: remove files superseded by the complete system" "Files from the earlier version of the project that no longer exist in the restructured system."
else
  commit "chore: remaining project files" "Files not covered by the feature commits above."
fi

# Safety net: secrets must never be tracked
if git ls-files | grep -E '(^|/)\.env$|\.pem$|\.key$|id_(rsa|ed25519)|node_modules/|/data/uploads/' >/dev/null; then
  echo "STOP: a secret or generated file is tracked. Fix .gitignore and start again." >&2; exit 1; fi
[ -z "$(git status --porcelain)" ] || { echo "Unexpected uncommitted files remain." >&2; git status --short; exit 1; }

echo; echo "Done: $n new commit(s), $(git ls-files | wc -l | tr -d ' ') files in the repository."
if [ "$EXISTING" = 1 ]; then git log --oneline -n "$((n + 3))"; else git log --oneline; fi

if [ "$EXISTING" = 1 ]; then
  [ -z "$REMOTE" ] || { git remote add origin "$REMOTE" 2>/dev/null || git remote set-url origin "$REMOTE"; }
  if git remote get-url origin >/dev/null 2>&1; then
    case "$BRANCH" in
      main|master) echo; echo "Pushing '$BRANCH' ..."; git push -u origin HEAD; echo; echo "Done: the new commits are on '$BRANCH' on top of your old ones." ;;
      *) echo; echo "Pushing branch '$BRANCH' (your main is not touched) ..."; git push -u origin HEAD
         echo; echo "Next: on GitHub open a Pull Request for '$BRANCH', check 'Files changed', and merge with 'Create a merge commit'." ;;
    esac
  else echo; echo "No 'origin' remote found. Push with: git push -u origin HEAD"; fi
elif [ -n "$REMOTE" ]; then
  git remote add origin "$REMOTE" 2>/dev/null || git remote set-url origin "$REMOTE"
  echo; echo "Pushing to $REMOTE ..."; git push -u origin main
else
  echo; echo "To publish:  git remote add origin git@github.com:YOUR_NAME/planetu-erp.git && git push -u origin main"
fi

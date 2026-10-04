# Deploying PlanetU ERP on Render, step by step

From your laptop to a live HTTPS site: GitHub first, then Render. Allow **about an hour** the first time.
Commands marked **[Mac]** go in the Terminal on your Mac.

> **Read this box first. It saves you a bad surprise.**
> Render's *free* plan is a good way to **demo** the system, but it has three built-in limits (checked against Render's own documentation, October 2026):
>
> | Limit on the free plan | What it means for you | What this project already does about it |
> |---|---|---|
> | The website **goes to sleep after 15 minutes** without visitors; the next visit takes about a minute to wake it | Open the site a minute before you present it. While asleep, nothing runs in the background (invoice reminders, emails). | Nothing; see Part G for options. |
> | The free **database is deleted 30 days after it is created** (14 days' grace to upgrade) | A free Render database is not a permanent home for data | Part G shows how to move to a new database in 10 minutes, tested. |
> | The **disk is wiped** on every restart or deploy | Uploaded documents would vanish | Uploads are stored **inside the database** instead (`STORAGE_DRIVER=db`), so they survive restarts. |
>
> Also: the free plan has **no Shell**, so your owner login is created from settings you enter in the Render dashboard (Part C), and the free database has **no backups**, so Part G shows how to take your own.
> If your manager needs it always-on, change `plan: free` to `plan: starter` in `render.yaml` (about $7 a month, no sleeping).

---

## Part A. Put the code on GitHub  **[Mac]**

**A1. Tell Git who you are (once per Mac).**
```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

**A2. Make an SSH key so your Mac can push to GitHub (once).** Press Enter at every question.
```bash
ssh-keygen -t ed25519 -C "you@example.com"
cat ~/.ssh/id_ed25519.pub
```
Copy the line printed. On github.com: your picture, **Settings, SSH and GPG keys, New SSH key**, paste, Save. Then check:
```bash
ssh -T git@github.com        # type yes if asked; it should say: Hi YOURNAME! You've successfully authenticated
```

**A3. Choose your case.**

* **Case 1: you have no repository for this yet (or want a brand-new one).** Create an empty one on github.com: **+ , New repository**, name `planetu-erp`, **Private**, and **do not** tick "Add a README" or ".gitignore". Then run, from the unzipped project folder:
  ```bash
  cd ~/path/to/planetu-erp                     # the folder containing package.json and render.yaml
  bash scripts/git-history.sh git@github.com:YOURNAME/planetu-erp.git
  ```
  This makes **19 feature-by-feature commits** (setup, core, web app shell, auth, files, admissions, students, fees, payments, attendance, exams, reports, billing, learning and quizzes, document viewer, demo data, production setup, Render support, docs), each with a proper message, and pushes them.

* **Case 2: you already have a repository with earlier work.** (Yours: `github.com/NeerajGupta18/PlanetU-ERP`, 2 commits.) The new commits go **on top of your existing ones, in the same repository**; nothing is deleted from its history, and you do not delete or rename anything on GitHub.
  ```bash
  git clone https://github.com/NeerajGupta18/PlanetU-ERP.git planetu-merge   # a fresh copy of your repository
  cd planetu-merge
  find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +            # empties the folder; .git (your history) stays
  cp -R ~/path/to/new/planetu-erp/. .                                         # puts the complete new project in
  bash scripts/git-history.sh --existing --allow-main                         # shows a summary, asks "Continue? [y/N]", pushes
  ```
  The script first shows **exactly what it will change, including every file that exists in your old repository but not in the new project** (for your repository that is one file: `server/src/db/store.js`, the old JSON-file store that PostgreSQL replaced). Read the list, answer `y`, and it makes about 20 commits and pushes them with a normal push (no force needed).
  *Signing in to push:* over `https://` GitHub asks for your username and a **personal access token** (github.com, Settings, Developer settings, Personal access tokens), not your password. Or use the SSH address from A2 (`git@github.com:NeerajGupta18/PlanetU-ERP.git`) in the `git clone` line.
  *Safer variant (review before `main` changes):* add `git checkout -b complete-system` after `cd planetu-merge`, and drop `--allow-main`. The script then pushes a branch; on github.com open the **Pull Request**, check **Files changed**, and merge with **"Create a merge commit"** (not "Squash", which would flatten the commits into one).
  *If your old repository ever had a password, key or `.env` file committed, it stays in the old history even after this. Change that secret.*
  *You can also deploy to Render straight from a branch before merging: in Part C, when Render asks for the branch, pick it.*

> The commits group the **final** files by feature. They tell the story of what the system contains; they are not a replay of every edit made while building it.
> The script checks at the end that no `.env` file, key or upload was committed, and in Case 1 it refuses to run in a folder that already has commits.

**From now on, every change is just:**
```bash
git add -A
git status                                   # check no secrets are listed
git commit -m "fix: describe what you changed"
git push
```

---

## Part B. Create the Render account and connect GitHub

1. Go to **render.com**, click **Get Started**, and **Sign up with GitHub**. (No credit card is needed for free services.)
2. When Render asks for GitHub access, choose **Only select repositories** and pick `planetu-erp`. You can change this later under GitHub, **Settings, Applications, Render**.

---

## Part C. Deploy with the Blueprint

The file `render.yaml` in the project tells Render to create **one web service and one PostgreSQL database**, already wired together.

1. In the Render dashboard click **New +**, then **Blueprint**.
2. Pick your repository and the branch that holds the complete project (**main**, or `complete-system` if you have not merged yet), and click **Connect**.
3. Render shows what it will create: the web service `planetu-erp` and the database `planetu-erp-db` (both **Free**, region **Singapore**).
   It asks for three values (your owner login for the platform):

   | Setting | Enter |
   |---|---|
   | `VENDOR_LOGIN` | A login of your choice, for example `platformowner` (not `SA001`) |
   | `VENDOR_EMAIL` | Your email address |
   | `VENDOR_PASSWORD` | A strong password: **at least 12 characters with upper-case, lower-case and a number, and not containing your login**. Weak or published demo passwords are refused. |
4. Click **Deploy Blueprint** (or **Apply**). Render builds the app. The first build takes **5 to 15 minutes** on the free plan.
5. Open the web service, then the **Logs** tab. Success looks like this:
   ```
   [migrate] single-role mode: ...
   [migrate] applied 001_multi_tenant_core.sql  ... (12 lines)
   [vendor] Owner account "platformowner" created. Remove VENDOR_PASSWORD from the settings now.
   [api] PlanetU ERP API running on http://localhost:10000      (the port number may differ)
   ```
   When the service shows **Live**, its address is at the top of the page (like `https://planetu-erp.onrender.com`).

> **If the Blueprint says you already have a free database:** Render allows one free PostgreSQL per workspace. Delete or upgrade the old one, or follow Part I.

---

## Part D. First login and three checks

**D1. Sign in as the owner.** Open your Render address. On the login page choose **Super Admin** (leave the institute code empty) and use `VENDOR_LOGIN` and `VENDOR_PASSWORD`.
(If the page takes a minute, the free service was asleep. Just wait.)

**D2. Remove the password setting.** Render dashboard, your web service, **Environment**, delete `VENDOR_PASSWORD`, **Save**. (`VENDOR_LOGIN` and `VENDOR_EMAIL` can stay; the app ignores them once the account exists.) Render redeploys. Your account is already stored in the database, so you can still sign in.
To change the password later, add `VENDOR_RESET` = `true` and a new `VENDOR_PASSWORD`, wait for the redeploy, sign in, then delete both settings.

**D3. Check that visitors are told apart (rate limits).** While signed in as the owner, open this address in the same browser:
```
https://YOUR-SERVICE.onrender.com/api/super-admin/diagnostics/network
```
Compare the `ip` it shows with your real public IP (search "what is my IP"). On Render the correct setting is `TRUST_PROXY_HOPS` = `3` (your request passes through Cloudflare and Render's own proxy before reaching the app), and `render.yaml` already says so. If `ip` is a different, internal-looking address (it starts with `10.` or `172.`), the number is too low: change it in `render.yaml`, **not** only in the dashboard (the Blueprint would put the old value back), push, and check again.

**D4. Create an institute and test an upload.**
1. **Institutes, Add institute.** Code (for example `demo-school`), name, type, first admin name and email. A **temporary password is shown once**: copy it.
2. Sign out, sign in as that institute's **Admin** with the temporary password, and set a new password when asked.
3. Open **Classes** (or **Courses** / **Programmes**, whatever your institute type calls them) in the menu and add at least one. Then open `https://YOUR-SERVICE.onrender.com/apply/demo-school` in a private window and submit an application **with a photo and a PDF**.
4. Back in the admin, **Admissions, Review, View**. The document should open on screen. Restart the service (**Manual Deploy, Deploy latest commit**) and view it again: it is still there, because it lives in the database.

---

## Part E. Updating later

Push to GitHub, nothing else:
```bash
git add -A && git commit -m "feat: describe the change" && git push
```
Render sees the push, rebuilds, applies new database changes automatically at start-up, and replaces the running version. Watch it under **Events** and **Logs**.
To undo a bad release: **Events**, pick an earlier successful deploy, **Rollback**; or `git revert HEAD && git push`.

---

## Part F. Email (optional)

Until you set this, emails (password-reset links, invoices) are only printed in the **Logs**. For real email, add to **Environment**:
`MAIL_TRANSPORT` = `smtp`, `SMTP_URL` = your provider's address (for example `smtps://user:password@smtp.yourprovider.com:465`), `MAIL_FROM_ADDRESS` = a sender address. Most providers have a free tier.
Also fill in your company details for invoices: `BILLING_VENDOR_NAME`, `BILLING_VENDOR_ADDRESS`, `BILLING_VENDOR_STATE`, `BILLING_VENDOR_GSTIN`.

---

## Part G. Keeping it healthy on the free plan

### G1. The 30-day database limit (put a reminder in your calendar for day 25)
Your database's expiry date is on its page in the dashboard. Before it, **move the data to a new database**. The easiest free choice that does not expire is **Neon** (neon.com; free: 0.5 GB, sleeps when idle).

1. **Take a portable copy** (needs the PostgreSQL tools once: `brew install libpq` and then `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`). In Render: your database, **Connections**, copy the **External Database URL**.
   ```bash
   pg_dump --no-owner --no-privileges "PASTE_EXTERNAL_URL" | gzip > erp-$(date +%F).sql.gz
   ```
   This one file contains **everything, including uploaded documents**.
2. Create the new database (on Neon: New project, copy its **connection string**).
3. Load the copy into it:
   ```bash
   gunzip -c erp-YYYY-MM-DD.sql.gz | psql "PASTE_NEW_CONNECTION_STRING"
   ```
4. Point the app at the new database. The two settings `DATABASE_URL` and `MIGRATE_DATABASE_URL` are linked to the old database by `render.yaml`, and a push would put that link back, so change **both** places:
   * In `render.yaml`, replace each of those two `fromDatabase:` blocks with `sync: false` (for example `- key: DATABASE_URL` followed by `sync: false`), delete the whole `databases:` section at the top, then `git add -A && git commit -m "chore: use an external database" && git push`.
   * In Render, web service, **Environment**: set `DATABASE_URL` and `MIGRATE_DATABASE_URL` to the **same** new connection string. For Neon also add `MAIL_POLL_SECONDS` = `600` so its database can sleep between visits. Save.
5. Check the site, then delete the old Render database.

(This procedure was tested here: dump, restore under a different database account, migrations report "up to date", logins work, and each institute still sees only its own data.)
Or simply upgrade the Render database to a paid plan before it expires; nothing else changes.

### G2. Backups
The free database has no backups. Every week or two, run the `pg_dump` command from G1 and keep the file somewhere safe. It is the only backup you have.

### G3. Sleeping
* For a **presentation**: open the site 2 minutes before. That is enough.
* To keep it awake **for free**: a monitoring service such as UptimeRobot can request `https://YOUR-SERVICE.onrender.com/api/health` every 5 minutes. That uses almost all of the 750 free hours in a month (24 x 31 = 744), leaving no margin, so only do it for one service.
* For real use: switch `plan: free` to `plan: starter` in `render.yaml`, push, and it never sleeps.

---

## Public demo mode (what to send to HR)

`render.yaml` sets `DEMO_MODE=true`. On every start the app loads the three sample institutes (a college, a school and a university, with students, staff, timetable, attendance, exams, fees, quizzes and more) **if they are missing**, and the login page shows a **Demo logins** panel. A visitor clicks Admin, Employee or Student under an institute, which fills in the form; they then tick "I'm not a robot" and sign in. So you can send HR one link:

```
https://planetu-erp.onrender.com/login
```

What it does and does not do:

* The panel lists **only the sample institutes**. Your owner (Super Admin) login is never shown and is not created by this. Keep it private.
* Visitors **cannot change** the passwords of the sample accounts (otherwise one person could lock everyone else out). Your own institutes are unaffected.
* Visitors **can** add, edit and delete data inside the sample institutes. Everything in them is fictional, so do not type real people's details there. Other institutes stay separate (each institute's data is isolated by the database).
* To put the samples back to how they started each time the site wakes up, add the setting `DEMO_RESET_ON_START` = `true` in **Environment**.
* To hide the panel: change `DEMO_MODE` to `"false"` in `render.yaml` and push. To hide a sample institute only, **suspend** it in the owner console (**Institutes**).
* The free plan sleeps after 15 idle minutes, so tell HR the first page can take up to a minute.

## Part H. When something does not work

| Problem | What to check |
|---|---|
| Build fails with `vite: not found` | The build command must be `npm ci --include=dev && npm run build` (it is in `render.yaml`). Check the service's **Settings, Build Command** was not changed. |
| Build fails about the Node version | In **Environment** set `NODE_VERSION` to `24.21.0`, or to `22` if Render does not list 24. |
| Logs say `DATABASE_URL connects as "..." which bypasses Row Level Security` | The database account is a superuser. The app refuses on purpose. Use a database whose login is an ordinary account (Neon, or another Render database). |
| Logs say `The database is empty (no tables yet)` | The migration step failed. Read the lines just above it in the Logs. |
| `[vendor] Owner account NOT created: ...` in the logs | The password was too weak or the login not allowed. Fix `VENDOR_PASSWORD` in **Environment** and save. |
| Site takes a minute, then works | The free service was asleep (Part G3). |
| People get "too many attempts" even though few are using it | Proxy count (Part D3): adjust `TRUST_PROXY_HOPS`. |
| Cannot sign in on the `.onrender.com` address | Make sure you use `https://`. |
| Upload says the file is too large | The limit is 5 MB per file (PDF, PNG or JPEG only). |
| Service suspended until next month | The 750 free hours were used up (for example by a keep-awake monitor plus another free service). Upgrade the plan or wait. |

## Part I. Setting it up by hand (if you cannot use a Blueprint)

Create a **PostgreSQL** (Free, Singapore) and a **Web Service** (Free, Singapore, runtime Node) from the same repository with:

| Field | Value |
|---|---|
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run db:migrate && npm start` |
| Health Check Path | `/api/health` |
| Environment | exactly the variables listed in `render.yaml` (set `DATABASE_URL` and `MIGRATE_DATABASE_URL` to the database's **Internal Database URL**, and give `JWT_SECRET` a long random value) |

## What is different from a normal server

* One database login runs the app and owns the tables (`DB_SINGLE_ROLE=true`). Tenant isolation still holds: row-level security is **forced** on every tenant table and the app refuses to start if the login could bypass it. What you lose is a second, database-level layer: the audit log can no longer be made un-editable *by the database* for the app's own login.
* Uploaded files live in PostgreSQL (`STORAGE_DRIVER=db`). Fine for a demo and modest use; a free database holds 1 GB in total. For heavy use, move to a paid plan or a server with a disk (see `DEPLOY.md`, Oracle).

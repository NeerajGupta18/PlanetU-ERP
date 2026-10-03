# Deploying PlanetU ERP on Oracle Cloud (free), step by step

From an empty Oracle account to a live HTTPS site, with GitHub for your code. Allow **1.5 to 2 hours** the first time.
You type commands in the **Terminal on your Mac** (marked **[Mac]**) and on the **server** (marked **[Server]**).

**What you end up with:** one free Oracle VM running the app (Node.js 24), PostgreSQL, and Caddy (HTTPS), updated by `git push` plus one command, with nightly backups.

| You need | Notes |
|---|---|
| An email address and a **credit card** | Oracle uses the card only to verify you. A credit card is accepted more often than a debit card. Use your real name and billing address exactly as the card has them. Don't use a VPN while signing up. |
| A **GitHub** account | Free. Your code goes in a *private* repository. |
| A **DuckDNS** account | Free; gives you a name like `myerp.duckdns.org` so you get a proper HTTPS address. |
| The project folder | `planetu-erp` (the unzipped project containing this file). |

> **Words used below.** *VM* = the rented computer. *SSH* = how you control it from your Mac. *Public IP* = its internet address.
> Oracle changes its website from time to time. If a button is named slightly differently, pick the closest one.

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
Copy the line that is printed. On github.com: your picture, then **Settings, SSH and GPG keys, New SSH key**, paste it, Save.
Check it works (type `yes` if asked):
```bash
ssh -T git@github.com        # should say: Hi YOURNAME! You've successfully authenticated
```

**A3. Create an empty PRIVATE repository.** On github.com click **+ , New repository**. Name: `planetu-erp`. Choose **Private**.
Do **not** tick "Add a README" or ".gitignore" (the project already has them). Click **Create repository**.

**A4. Commit and push the project.**
```bash
cd ~/path/to/planetu-erp                 # the folder that contains package.json and DEPLOY.md
git init -b main
git add .
git status                               # LOOK at this list. It must NOT show .env, node_modules, data or any key file.
git commit -m "Initial commit: PlanetU ERP"
git remote add origin git@github.com:YOURNAME/planetu-erp.git
git push -u origin main
```
Reload the repository page: your files are there. The project's `.gitignore` keeps secrets and uploaded files out of Git. **Never commit passwords, `.env` files or private keys.**

---

## Part B. Create the Oracle account and the VM

**B1. Sign up.** Go to `oracle.com/cloud/free`, click **Start for free**, and fill in the form.
Choose your **Home Region** carefully, because it **cannot be changed later**. Pick the one closest to your users (for India, Mumbai or Hyderabad).
Verify the card (a small temporary charge may appear and is reversed). Wait for the "your account is ready" email, then sign in to the console.

**B2. Create the VM.** In the console open the menu (three lines) and go to **Compute, Instances, Create instance**.

| Field | Choose |
|---|---|
| Name | `erp-server` |
| Image | **Change image**, then **Canonical Ubuntu 24.04** (the normal one, not "Minimal"). Make sure it is the ARM (aarch64) build if you are using an Ampere shape. |
| Shape | **Change shape**, then **Ampere**, **VM.Standard.A1.Flex**, **2 OCPU and 12 GB memory** (or 4 and 24 if you want it all). It must show the **Always Free-eligible** label. |
| Networking | Keep the defaults ("Create new virtual cloud network"), and make sure **Assign a public IPv4 address** is on. |
| SSH keys | Choose **Generate a key pair for me** and click **Save private key** (and Save public key). Keep the private key safe. Without it you cannot get in. |
| Boot volume | Tick **Specify a custom boot volume size** and enter **100** (GB). Free storage is 200 GB in total. |

Click **Create**. After a minute the status turns **Running**. Copy the **Public IP address** shown on the page.

> **"Out of capacity for shape VM.Standard.A1.Flex"?** This is common. Try another *Availability domain* in the Placement section, try 1 OCPU / 6 GB, or simply retry in a few hours (early morning works well).
> Fallback: the free **VM.Standard.E2.1.Micro** (1 GB RAM) also runs this, but add swap (Part D, step D7) because the build needs more memory.

**B3. Log in from your Mac.** The downloaded key is usually in `~/Downloads`.
```bash
mkdir -p ~/.ssh && mv ~/Downloads/ssh-key-*.key ~/.ssh/oracle_erp.key
chmod 400 ~/.ssh/oracle_erp.key
ssh -i ~/.ssh/oracle_erp.key ubuntu@YOUR_PUBLIC_IP      # type yes when asked
```
You are now **[Server]**. The prompt shows `ubuntu@erp-server`. (Type `exit` to come back to your Mac.)
Handy: add this to `~/.ssh/config` on the Mac so you can just type `ssh erp`:
```
Host erp
  HostName YOUR_PUBLIC_IP
  User ubuntu
  IdentityFile ~/.ssh/oracle_erp.key
```

---

## Part C. Open the network

Two separate gates must be opened for web traffic (ports 80 and 443). Never open 5000 (the app) or 5432 (the database).

**C1. Oracle console gate.** Menu, **Networking, Virtual cloud networks**, click your VCN, click the **public subnet**, click its **Default Security List**, **Add Ingress Rules**:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |

Add a second rule the same way with port `443`. (Port 22 for SSH is already there.)

**C2. The server's own firewall  [Server].** Oracle's Ubuntu image also blocks these ports inside the VM.
```bash
sudo iptables -I INPUT -p tcp --dport 80  -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
sudo apt update && sudo apt install -y iptables-persistent   # answer Yes if it asks to save the current rules
sudo netfilter-persistent save
```

**C3. Get a free web address.** Go to `duckdns.org`, sign in (GitHub or Google works), type a name (for example `myerp`) in **sub domain**, click **add domain**, then paste your **Public IP** in the *current ip* box and click **update ip**. Your address is `myerp.duckdns.org`.
Check from the server in a minute: `getent hosts myerp.duckdns.org` should print your Public IP.

---

## Part D. Prepare the server  **[Server]**

**D1. Update the system.**
```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y git curl ca-certificates gnupg openssl
```

**D2. Node.js 24** (Node 20 is end-of-life and gets no security fixes).
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # v24.x
```

**D3. PostgreSQL** (it only listens on this machine, which is what we want).
```bash
sudo apt install -y postgresql
psql --version   # 16.x
```

**D4. Caddy** (serves your site over HTTPS and renews the certificate by itself).
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

**D5. Make three secrets and SAVE THEM in a password manager now.** They stay in this terminal session for the next steps.
```bash
OWNER_PW=$(openssl rand -hex 24); APP_PW=$(openssl rand -hex 24); JWT=$(openssl rand -hex 32)
echo "owner=$OWNER_PW"; echo "app=$APP_PW"; echo "jwt=$JWT"
```

**D6. Create the database and the user that runs the app.**
```bash
sudo -u postgres psql -c "create role erp_owner login createrole password '$OWNER_PW'"
sudo -u postgres psql -c "create database planetu_erp owner erp_owner"

sudo adduser --system --group --home /opt/erp --shell /usr/sbin/nologin erp
sudo mkdir -p /opt/erp/app /var/lib/erp/uploads /var/backups/erp /etc/erp
sudo chown -R erp:erp /opt/erp /var/lib/erp
```
`erp_owner` can build tables but is **not** a superuser. The app itself will connect as a more restricted role, `erp_app`, that cannot see across institutes.

**D7. (Only for the 1 GB fallback VM) add swap.**
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Part E. Get the code onto the server  **[Server]**

The server needs read-only permission to your *private* repository. A **deploy key** gives exactly that.

**E1. Make a key for the server's `erp` user.**
```bash
sudo -u erp -H mkdir -p /opt/erp/.ssh
sudo -u erp -H chmod 700 /opt/erp/.ssh
sudo -u erp -H ssh-keygen -t ed25519 -N "" -C "erp-server-deploy-key" -f /opt/erp/.ssh/id_ed25519
sudo cat /opt/erp/.ssh/id_ed25519.pub
```
Copy the printed line.

**E2. Give it to GitHub.** Your repository, **Settings, Deploy keys, Add deploy key**. Title `oracle-server`, paste the line, leave **"Allow write access" unticked**, Add key.

**E3. Clone.**
```bash
sudo -u erp -H bash -c 'ssh-keyscan -t ed25519 github.com >> /opt/erp/.ssh/known_hosts'
sudo -u erp -H git clone git@github.com:YOURNAME/planetu-erp.git /opt/erp/app
ls /opt/erp/app          # you should see package.json, client, server, deploy ...
```

---

## Part F. Configure, build and create your login  **[Server]**

**F1. Create the settings file** (it stays on the server and is never committed).
```bash
sudo cp /opt/erp/app/deploy/erp.env.example /etc/erp/erp.env
sudo sed -i "s/CHANGE-ME-OWNER-PASSWORD/$OWNER_PW/; s/CHANGE-ME-APP-PASSWORD/$APP_PW/g; s/^JWT_SECRET=.*/JWT_SECRET=$JWT/; s/CHANGE-ME.duckdns.org/myerp.duckdns.org/g" /etc/erp/erp.env
sudo chown root:erp /etc/erp/erp.env && sudo chmod 640 /etc/erp/erp.env
grep -n "CHANGE-ME" /etc/erp/erp.env || echo "no placeholders left"
```
(Use your own DuckDNS name instead of `myerp`.) Then fill in your company details used on invoices:
```bash
sudo nano /etc/erp/erp.env       # edit BILLING_VENDOR_*; Ctrl+O Enter saves, Ctrl+X exits. Keep "quotes" around values with spaces.
```

**F2. Install, build and create the tables.**
```bash
sudo -u erp -H bash -c 'cd /opt/erp/app && npm ci && npm run build'
sudo -u erp -H bash -c 'cd /opt/erp/app && set -a && . /etc/erp/erp.env && set +a && npm run db:migrate'
```
You should see a line `[migrate] applied ...` for each of the 11 migrations.

**F3. Create YOUR platform-owner account.** Choose your own login (not `SA001`). You will be asked for a password (typing is hidden): at least 12 characters with upper-case, lower-case and a number, and not containing your login.
```bash
sudo -u erp -H bash -c 'cd /opt/erp/app && set -a && . /etc/erp/erp.env && set +a && npm run create-vendor -- --login=YOURLOGIN --email=you@example.com --name="Your Name"'
```

> **Never run `npm run db:setup` on the server.** It creates demo institutes with public passwords. It refuses to run in production anyway.

---

## Part G. Run the app as a service  **[Server]**

```bash
sudo cp /opt/erp/app/deploy/erp.service /etc/systemd/system/erp.service
sudo systemctl daemon-reload
sudo systemctl enable --now erp
sudo systemctl status erp --no-pager        # should say: active (running)
curl -s http://127.0.0.1:5000/api/health    # {"ok":true}
```
It now starts by itself after a reboot and restarts if it crashes. If it does not start: `journalctl -u erp -n 50 --no-pager` shows why.

---

## Part H. Switch on HTTPS  **[Server]**

```bash
sudo cp /opt/erp/app/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i "s/CHANGE-ME.duckdns.org/myerp.duckdns.org/" /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo journalctl -u caddy -n 20 --no-pager         # look for "certificate obtained successfully"
```
Open **https://myerp.duckdns.org** in your browser. You should see the login page with a padlock.

---

## Part I. First login and a real test

1. On the login page choose **Super Admin** (leave the institute code empty), and sign in with the account from F3.
2. **Institutes, Add institute.** Give a code (for example `first-school`), name, type, and the first admin's name and email. A **temporary password is shown once**: copy it.
3. Sign out. Sign in with that institute code as **Admin** with the temporary password. You will be forced to set a new password.
4. As that admin, add a class/course under the institute setup, then open `https://myerp.duckdns.org/apply/first-school` in a private window and submit a test application **with a document**.
5. Back in Admissions, click **Review**, then **View** on the document. Confirm the file exists on disk: `sudo ls -R /var/lib/erp/uploads | head`.
6. **Reboot test:** `sudo reboot`, wait a minute, SSH in again and reload the site. It must come back on its own.

---

## Part J. Backups (do this before you invite real users)  **[Server]**

Uploaded documents are **files on disk, not in the database**, so both must be backed up. The script backs up both and checks the result.
```bash
sudo install -m 750 -o root -g root /opt/erp/app/deploy/backup.sh /usr/local/sbin/erp-backup
sudo /usr/local/sbin/erp-backup                       # run it once now; it prints "[backup] ok ..."
echo '30 2 * * * root /usr/local/sbin/erp-backup >> /var/log/erp-backup.log 2>&1' | sudo tee /etc/cron.d/erp-backup
sudo chmod 644 /etc/cron.d/erp-backup
```
This keeps 14 days in `/var/backups/erp` every night at 02:30.

**Also keep a copy off the server** (the VM itself can be lost). Run this on your **[Mac]** every week or two:
```bash
mkdir -p ~/erp-backups
ssh erp "sudo tar -czf - -C /var/backups erp" > ~/erp-backups/erp-$(date +%F).tar.gz
```
You can also create a free boot-volume backup in the Oracle console (Storage, Boot volumes, your volume, Backups).

**Restoring** (a damaged database, or a brand-new server after Parts D to F):
```bash
sudo systemctl stop erp
sudo -u postgres psql -c "drop database if exists planetu_erp" -c "create database planetu_erp owner erp_owner"
sudo -u postgres psql -c "create role erp_app login password '$APP_PW' nosuperuser nobypassrls" 2>/dev/null || true
gunzip -c /var/backups/erp/db-YYYYMMDD-HHMMSS.sql.gz | sudo -u postgres psql -q -v ON_ERROR_STOP=1 planetu_erp
sudo tar -xzf /var/backups/erp/uploads-YYYYMMDD-HHMMSS.tar.gz -C /var/lib/erp
sudo chown -R erp:erp /var/lib/erp
sudo -u erp -H bash -c 'cd /opt/erp/app && set -a && . /etc/erp/erp.env && set +a && npm run db:migrate'
sudo systemctl start erp
```
(Use the real file names from `ls /var/backups/erp`. On a new server, `$APP_PW` must be the same value as `APP_DB_PASSWORD` in `/etc/erp/erp.env`; read it with `sudo grep APP_DB_PASSWORD /etc/erp/erp.env`.) A migrate message saying it "could not set the erp_app password" is normal after a restore.

---

## Part K. Updating later: commit, push, deploy

**[Mac]** make your change, then:
```bash
git add -A
git status                      # check no secrets are listed
git commit -m "Describe what you changed"
git push
```
**[Server]** deploy it:
```bash
/opt/erp/app/deploy/update.sh
```
It takes a backup, pulls the code, installs and builds, applies database changes, restarts the app and checks it is healthy. If it ends with `Deployed OK.` you are live.

**If a release goes wrong:** on your Mac run `git revert HEAD` then `git push` and run `update.sh` again. Database changes only move forward, so if a database change itself was the problem, restore the backup the update script made just before (Part J, Restoring).

Useful commands on the server:
```bash
sudo systemctl status erp          # is it running?
journalctl -u erp -f               # live app log (Ctrl+C to stop)
sudo systemctl restart erp
df -h /                            # free disk space
```

---

## Part L. When something does not work

| Problem | Check |
|---|---|
| Site will not load at all | DNS: `getent hosts myerp.duckdns.org` must show your Public IP. Both gates open: Part C1 (Oracle) **and** C2 (server). `sudo systemctl status caddy`. |
| Browser says "certificate" error | Caddy could not get a certificate: DNS wrong or ports closed. `sudo journalctl -u caddy -n 50`. Fix, then `sudo systemctl restart caddy`. |
| "502 Bad Gateway" | The app is down. `sudo systemctl status erp`, then `journalctl -u erp -n 50 --no-pager`. |
| Login keeps failing or loops | You must use the **https://** address (cookies are secure-only). |
| `git clone` / `git pull`: Permission denied (publickey) | The deploy key was not added to the repository (E2), or you ran git as the wrong user. Always use `sudo -u erp -H git ...`. |
| `db:migrate` says "permission denied to alter role" | `erp_app` was marked as a superuser or able to bypass security by someone. Do not work around it: fix it as the postgres superuser with `sudo -u postgres psql -c "alter role erp_app nosuperuser nobypassrls nocreatedb nocreaterole"`. |
| Forgot your owner password | `... npm run create-vendor -- --login=YOURLOGIN --email=you@example.com --reset` (same command as F3 plus `--reset`). |
| Can't create the VM ("Out of capacity") | See the note under B2. |
| Not receiving emails | `MAIL_TRANSPORT=log` only prints them (`journalctl -u erp`). Set up SMTP in `/etc/erp/erp.env`, then `sudo systemctl restart erp`. |

## Keep it safe and free

* Only SSH (22), 80 and 443 are open. Leave it that way. SSH uses your key only.
* Ubuntu installs security updates automatically. Once a month run `sudo apt update && sudo apt -y upgrade` and reboot if asked.
* Stay on shapes marked **Always Free-eligible** and don't "upgrade" your account to paid unless you mean to.
* Oracle may reclaim a free VM that stays idle for a long time. That is why Part J's off-server backup matters: with it and this guide you can rebuild the whole site in under an hour.
* Keep the saved secrets (D5) and the private SSH key in a password manager.

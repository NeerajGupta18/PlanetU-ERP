#!/usr/bin/env bash
# Deploys the latest code from GitHub. Run on the server as the normal (sudo-capable) user:
#   /opt/erp/app/deploy/update.sh
# It backs up first, so a bad release can be undone.
set -euo pipefail
APP=/opt/erp/app

echo "== 1/6 backup (before anything changes)"
if [ -x /usr/local/sbin/erp-backup ]; then sudo /usr/local/sbin/erp-backup; else echo "No backup script installed yet (see DEPLOY.md, Part J). Continuing without a backup."; read -r -p "Continue anyway? [y/N] " a; [ "$a" = y ] || exit 1; fi

echo "== 2/6 pull the latest code"
sudo -u erp -H git -C "$APP" pull --ff-only
# The nightly backup runs as root, so root keeps its own copy of the script rather than running one the app user can edit
sudo install -m 750 -o root -g root "$APP/deploy/backup.sh" /usr/local/sbin/erp-backup

echo "== 3/6 install dependencies and build the web app"
sudo -u erp -H bash -c "cd '$APP' && npm ci && npm run build"

echo "== 4/6 apply database migrations"
sudo -u erp -H bash -c "cd '$APP' && set -a && . /etc/erp/erp.env && set +a && npm run db:migrate"

echo "== 5/6 restart"
sudo systemctl restart erp

echo "== 6/6 health check"
sleep 4
PORT="$(sudo grep -E '^PORT=' /etc/erp/erp.env | cut -d= -f2 || true)"
curl -fsS "http://127.0.0.1:${PORT:-5000}/api/health" && echo && echo "Deployed OK."

#!/usr/bin/env bash
# Backs up the database AND the uploaded files (they are not in the database). Run as root (cron does).
#   sudo /opt/erp/app/deploy/backup.sh
# Keeps 14 days by default:  KEEP_DAYS=30 sudo -E /opt/erp/app/deploy/backup.sh
set -euo pipefail
umask 077
DIR="${BACKUP_DIR:-/var/backups/erp}"
DB="${DB_NAME:-planetu_erp}"
UPLOADS="${UPLOAD_DIR:-/var/lib/erp/uploads}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DIR"
runuser -u postgres -- pg_dump "$DB" | gzip > "$DIR/db-$STAMP.sql.gz"
mkdir -p "$UPLOADS"
tar -czf "$DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"

# A backup you have not checked is a hope, not a backup
gzip -t "$DIR/db-$STAMP.sql.gz"
tar -tzf "$DIR/uploads-$STAMP.tar.gz" > /dev/null
[ "$(gzip -dc "$DIR/db-$STAMP.sql.gz" | grep -c 'CREATE TABLE')" -gt 20 ] || { echo "[backup] dump looks empty" >&2; exit 1; }

find "$DIR" -type f \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "[backup] ok $STAMP -> $DIR ($(du -sh "$DIR" | cut -f1) total)"

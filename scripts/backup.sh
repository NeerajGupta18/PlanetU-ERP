#!/usr/bin/env bash
# Backs up the PostgreSQL database to one file (custom format, compressed). Uploaded documents live in the
# database too (file_blobs), so this one file is everything.
#
#   scripts/backup.sh                       local database  -> backups/planetu-<time>.dump
#   scripts/backup.sh "postgres://..."      any database (use the OWNER address, e.g. Render's External URL)
#   BACKUP_DIR=/somewhere KEEP=30 scripts/backup.sh
#
# The address can also come from BACKUP_DATABASE_URL or MIGRATE_DATABASE_URL. Run as the database owner:
# tables use forced row-level security, and the app's own login (erp_app) would see no rows.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/pg-tools.sh"

URL="${1:-${BACKUP_DATABASE_URL:-${MIGRATE_DATABASE_URL:-$LOCAL_DEFAULT_URL}}}"
DIR="${BACKUP_DIR:-$HERE/../backups}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
FILE="$DIR/planetu-$STAMP.dump"

echo "[backup] from $(safe_url "$URL")"
if ! pg_tool pg_dump --format=custom --no-owner --no-privileges "$URL" > "$FILE.part"; then
  rm -f "$FILE.part"
  echo "[backup] failed: check the address and that this login owns the tables (see the message above)." >&2
  exit 1
fi
mv "$FILE.part" "$FILE"

# A backup you have not checked is a hope, not a backup: it must list the app's tables and their data
LIST="$(pg_tool pg_restore --list < "$FILE")"
TABLES="$(printf '%s\n' "$LIST" | grep -c ' TABLE public ' || true)"
DATA="$(printf '%s\n' "$LIST" | grep -c ' TABLE DATA public ' || true)"
if [ "$TABLES" -lt 20 ] || [ "$DATA" -lt 20 ]; then
  echo "[backup] the file looks incomplete ($TABLES tables, $DATA with data). Kept at $FILE for checking." >&2
  exit 1
fi

# Keep the newest $KEEP backups in this folder
ls -1t "$DIR"/planetu-*.dump 2> /dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
echo "[backup] ok $FILE ($(du -h "$FILE" | cut -f1), $TABLES tables)"

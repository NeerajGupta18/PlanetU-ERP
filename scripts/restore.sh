#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh. This REPLACES what is in the target database.
#
#   scripts/restore.sh backups/planetu-<time>.dump                    into the local database
#   scripts/restore.sh backups/planetu-<time>.dump "postgres://..."   into another LOCAL database
#
# Asks you to type the database name first (or pass --yes). It refuses any database that is not on this machine
# unless ALLOW_REMOTE_RESTORE=yes is set, so a live database is never overwritten by accident.
# Afterwards it runs the migrations, which give the app's login (erp_app) its access again.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/pg-tools.sh"

YES=no
ARGS=()
for a in "$@"; do if [ "$a" = "--yes" ]; then YES=yes; else ARGS+=("$a"); fi; done
FILE="${ARGS[0]:-}"
URL="${ARGS[1]:-${RESTORE_DATABASE_URL:-${MIGRATE_DATABASE_URL:-$LOCAL_DEFAULT_URL}}}"

[ -n "$FILE" ] || { echo "Usage: scripts/restore.sh <backup file> [database address] [--yes]" >&2; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE. List your backups with: ls -lt backups/" >&2; exit 2; }
DBNAME="$(printf '%s' "$URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')"
HOST="$(printf '%s' "$URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/]+).*#\2#')"
case "$HOST" in
  localhost|127.0.0.1|host.docker.internal) ;;
  *) [ "${ALLOW_REMOTE_RESTORE:-}" = "yes" ] || { echo "Refusing to restore into $HOST: it is not on this machine. Set ALLOW_REMOTE_RESTORE=yes only if you are sure." >&2; exit 2; } ;;
esac

# Check the file before touching the database
pg_tool pg_restore --list < "$FILE" > /dev/null || { echo "$FILE is not a readable backup." >&2; exit 1; }

echo "[restore] $FILE -> $(safe_url "$URL")"
if [ "$YES" != "yes" ]; then
  printf 'This replaces everything in "%s". Type the database name to continue: ' "$DBNAME"
  read -r answer
  [ "$answer" = "$DBNAME" ] || { echo "[restore] cancelled, nothing changed."; exit 1; }
fi

# One transaction: if anything fails, the database is left exactly as it was
pg_tool pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$URL" < "$FILE"
echo "[restore] data restored; running migrations to restore the app's access"
(cd "$HERE/.." && MIGRATE_DATABASE_URL="$URL" npm run db:migrate --silent)
echo "[restore] ok"

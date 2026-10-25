# Shared by backup.sh and restore.sh (sourced, not run). Finds pg_dump / pg_restore: the installed ones if present,
# otherwise the same tools from the postgres Docker image, so a laptop without PostgreSQL installed still works.
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
LOCAL_DEFAULT_URL='postgres://erp_owner:erp_owner_dev@localhost:5432/planetu_erp'

# The database address without its password, safe to print
safe_url() { printf '%s' "$1" | sed -E 's#://([^:/@]+):[^@]*@#://\1:***@#'; }

# Runs a PostgreSQL client tool (pg_dump, pg_restore) with stdin/stdout passed through
pg_tool() {
  local tool="$1"; shift
  if command -v "$tool" > /dev/null 2>&1; then
    "$tool" "$@"
  elif command -v docker > /dev/null 2>&1; then
    # Inside the container "localhost" is the container itself; host.docker.internal is this machine
    local args=() a
    for a in "$@"; do args+=("$(printf '%s' "$a" | sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#')"); done
    docker run --rm -i --add-host=host.docker.internal:host-gateway "$PG_IMAGE" "$tool" "${args[@]}"
  else
    echo "Neither $tool nor Docker was found. Install the PostgreSQL client tools (brew install libpq) or Docker, then try again." >&2
    return 127
  fi
}

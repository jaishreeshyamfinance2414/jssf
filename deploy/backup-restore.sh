#!/usr/bin/env bash
# Restore the newest downloaded JSSF database backup from ~/backups.
# Usage: ./backup-restore.sh RESTORE
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${BACKEND_DIR:-$SCRIPT_DIR/../backend}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"

if [[ "${1:-}" != "RESTORE" ]]; then
  echo "Usage: $0 RESTORE" >&2
  echo "WARNING: This replaces the current application database." >&2
  exit 1
fi

command -v gzip >/dev/null || {
  echo "ERROR: gzip is not installed." >&2
  exit 1
}

command -v psql >/dev/null || {
  echo "ERROR: PostgreSQL client tools are not installed." >&2
  exit 1
}

command -v pm2 >/dev/null || {
  echo "ERROR: pm2 is not installed." >&2
  exit 1
}

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "ERROR: Application environment file not found: $BACKEND_DIR/.env" >&2
  exit 1
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "ERROR: Backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi

LATEST_BACKUP="$(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'jssf_*.sql.gz' \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | sed -n '1{s/^[^ ]* //;p;}'
)"

if [[ -z "$LATEST_BACKUP" ]]; then
  echo "ERROR: No downloaded JSSF backup was found in $BACKUP_DIR." >&2
  exit 1
fi

gzip -t "$LATEST_BACKUP"

set -a
# setup-server.sh writes a shell-compatible environment file.
# shellcheck source=/dev/null
source "$BACKEND_DIR/.env"
set +a

: "${DATABASE_URL:?DATABASE_URL is missing from $BACKEND_DIR/.env}"

RESTORE_SQL="$(mktemp /tmp/jssf-restore.XXXXXX.sql)"
API_STOPPED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  rm -f -- "$RESTORE_SQL"
  if [[ "$API_STOPPED" -eq 1 ]]; then
    pm2 restart jssf-api --update-env >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "Expanding $LATEST_BACKUP"
gzip -cd "$LATEST_BACKUP" > "$RESTORE_SQL"

FIRST_TWO_LINES="$(sed -n '1,2p' "$RESTORE_SQL")"
if [[ "$FIRST_TWO_LINES" != $'--\n-- PostgreSQL database dump' ]]; then
  echo "ERROR: The selected file is not a PostgreSQL backup created by JSSF." >&2
  exit 1
fi

echo "Stopping jssf-api"
pm2 stop jssf-api
API_STOPPED=1

echo "Restoring $LATEST_BACKUP"
psql "$DATABASE_URL" \
  --no-psqlrc \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  --command 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' \
  --file "$RESTORE_SQL"

echo "Starting jssf-api"
pm2 restart jssf-api --update-env
API_STOPPED=0

rm -f -- "$RESTORE_SQL"
trap - EXIT INT TERM

echo "Restore completed successfully from: $LATEST_BACKUP"

#!/usr/bin/env bash
# Runs the same backup script as the existing server cron, then records an
# unambiguous final result in the caller's log even if the API restarts.
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-db.sh"
echo "$(date -Is) BACKUP_NOW_STARTED"
if /usr/bin/bash "$SCRIPT"; then
  echo "$(date -Is) BACKUP_NOW_SUCCESS"
else
  code=$?
  echo "$(date -Is) ERROR: BACKUP_NOW_FAILED (exit status $code)"
  exit "$code"
fi

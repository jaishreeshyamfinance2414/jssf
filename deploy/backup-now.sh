#!/usr/bin/env bash
# Runs the same backup script as the existing server cron. The API directs
# stdout and stderr to the shared backup.log file.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-db.sh"
export BACKUP_SOURCE=manual
exec /usr/bin/bash "$SCRIPT"

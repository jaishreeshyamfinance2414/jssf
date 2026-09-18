#!/usr/bin/env bash
# Root cron invokes this fixed wrapper. It records one machine-readable result
# and retains the normal backup output in /var/log/jssf-backup.log.
set -uo pipefail
umask 077
STATUS_DIR=/var/lib/jssf
STATUS_FILE="$STATUS_DIR/backup-status.tsv"
LOG_FILE=/var/log/jssf-backup.log
BACKUP_SCRIPT=/usr/local/libexec/jssf/backup-db.sh
mkdir -p "$STATUS_DIR"
output="$(mktemp "$STATUS_DIR/backup-output.XXXXXX")" || exit 1
trap 'rm -f "$output"' EXIT

write_status() {
  local temp
  temp="$(mktemp "$STATUS_DIR/backup-status.XXXXXX")" || return 1
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" > "$temp"
  mv -f "$temp" "$STATUS_FILE"
}

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_status running "$started" - -
if /usr/bin/bash "$BACKUP_SCRIPT" > "$output" 2>&1; then
  outcome=success
  code=0
else
  code=$?
  outcome=failed
fi
cat "$output" >> "$LOG_FILE"
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "$outcome" == failed ]]; then
  error="$(grep -iE 'error:|failed|denied|fatal:' "$output" | tail -n 4 || true)"
  [[ -n "$error" ]] || error="$(tail -n 4 "$output")"
  [[ -n "$error" ]] || error="Backup script exited with status $code without writing an error."
  encoded="$(printf '%s' "$error" | head -c 2000 | base64 -w0)"
else
  encoded=-
fi
write_status "$outcome" "$started" "$finished" "$encoded"
exit "$code"

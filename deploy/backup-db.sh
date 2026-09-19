#!/usr/bin/env bash
# Nightly PostgreSQL backup to Backblaze B2 via AWS CLI (S3-compatible API).
#
# Backup destinations:
#   - Local disk   ~/backups/           (7-day retention)
#   - Backblaze B2 database/           (daily / weekly / monthly tiers)
#
# Customer documents are stored in Cloudflare R2 by the application itself
# and are NOT copied by this script. R2 is their primary (and only) store.
#
# The existing root crontab runs this script daily. Settings can show the
# latest result or run the same script immediately; it does not edit crontab.
# Example: 17 2 * * * /usr/bin/bash /home/ubuntu/jssf/deploy/backup-db.sh
#
# Database connection loads from backend/.env, using the same selection as the
# application (DATABASE_URL takes precedence over PGHOST/PGDATABASE/etc.).
# B2 credentials load from ~/.config/jssf/backup.env unless BACKUP_ENV_FILE is
# set explicitly (see backup.env.example).
# If the file is absent or B2 variables are not set, the script still creates a
# local backup and exits cleanly.
#
# NOTE: The previous version of this script also supported Google Drive via
# rclone. That has been removed. An archived copy is kept as
# deploy/backup-db-gdrive.sh — see BACKUP-LEGACY.md for details.
set -euo pipefail

RUN_SOURCE=scheduled
if [[ "${BACKUP_SOURCE:-}" == manual ]]; then RUN_SOURCE=manual; fi
RUN_ID="$(date +%Y%m%dT%H%M%S)-$BASHPID"
echo "$(date -Is) BACKUP_RUN_STARTED id=$RUN_ID source=$RUN_SOURCE"

# Both the root cron and Backup Now invoke this same script path. Lock the
# script inode so two dumps cannot overlap or overwrite the same archive.
exec 9< "$0"
if ! flock -n 9; then
  echo "$(date -Is) ERROR: A database backup is already running."
  echo "$(date -Is) BACKUP_RUN_FAILED id=$RUN_ID source=$RUN_SOURCE exit=1"
  exit 1
fi

log() {
  echo "$(date -Is) $*"
}

log_exit_status() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    log "BACKUP_RUN_FAILED id=$RUN_ID source=$RUN_SOURCE exit=$status"
  fi
}
trap log_exit_status EXIT

# ---------------------------------------------------------------------------
# Load credentials from the protected environment file
# ---------------------------------------------------------------------------
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$HOME/.config/jssf/backup.env}"
if [[ -f "$BACKUP_ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$BACKUP_ENV_FILE"
  set +a
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BACKUP_DIR="$HOME/backups"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
LOCAL_KEEP_DAYS=7        # local .gz files older than this are deleted
STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILE="$BACKUP_DIR/jssf_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
BACKUP_FAILED=0

# ---------------------------------------------------------------------------
# 1. Dump the database configured for the application and validate the archive
# ---------------------------------------------------------------------------
if [[ ! -f "$BACKEND_DIR/.env" || ! -f "$BACKEND_DIR/dist/scripts/backup-dump.js" ]]; then
  log 'ERROR: application database configuration or compiled backup helper is missing'
  exit 1
fi
dump_target="$(cd "$BACKEND_DIR" && node dist/scripts/backup-dump.js "$FILE")"
gzip -t "$FILE"
log "$dump_target"
log "wrote and validated $FILE ($(du -h "$FILE" | cut -f1))"

# ---------------------------------------------------------------------------
# 2. Upload to Backblaze B2 (S3-compatible API via AWS CLI)
#    Skipped cleanly if credentials are not configured.
# ---------------------------------------------------------------------------
if [[ -n "${B2_BUCKET:-}" || -n "${B2_KEY_ID:-}" || -n "${B2_APPLICATION_KEY:-}" || -n "${B2_ENDPOINT:-}" ]]; then
  # If any B2 var is set, require all four — catches partial configuration.
  : "${B2_BUCKET:?B2_BUCKET is required when B2 backup is enabled}"
  : "${B2_KEY_ID:?B2_KEY_ID is required when B2 backup is enabled}"
  : "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY is required when B2 backup is enabled}"
  : "${B2_ENDPOINT:?B2_ENDPOINT is required when B2 backup is enabled}"
  command -v aws >/dev/null || { log "ERROR: aws CLI is required for B2 backup"; exit 1; }

  # Derive region from endpoint (e.g. s3.us-west-004.backblazeb2.com → us-west-004)
  B2_ENDPOINT_HOST="${B2_ENDPOINT#https://}"
  B2_REGION="${B2_REGION:-${B2_ENDPOINT_HOST#s3.}}"
  B2_REGION="${B2_REGION%%.*}"

  # Wrapper: run aws commands with B2 credentials without touching ~/.aws
  b2_aws() {
    AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
    AWS_DEFAULT_REGION="$B2_REGION" \
      aws --endpoint-url "$B2_ENDPOINT" "$@"
  }

  # Upload a file and verify remote size matches local
  b2_upload_and_verify() {
    local source_file="$1"
    local object_key="$2"
    local local_size remote_size
    local_size="$(stat -c %s "$source_file")"

    if ! b2_aws s3 cp "$source_file" "s3://$B2_BUCKET/$object_key" --only-show-errors; then
      log "ERROR: B2 upload failed for $object_key"
      return 1
    fi
    if ! remote_size="$(b2_aws s3api head-object --bucket "$B2_BUCKET" --key "$object_key" --query ContentLength --output text)"; then
      log "ERROR: B2 could not verify $object_key"
      return 1
    fi
    if [[ "$remote_size" != "$local_size" ]]; then
      log "ERROR: B2 verification failed for $object_key (local=$local_size remote=$remote_size)"
      return 1
    fi
    log "uploaded and verified B2 s3://$B2_BUCKET/$object_key ($remote_size bytes)"
  }

  BACKUP_NAME="${FILE##*/}"
  B2_FAILED=0

  # Daily backup — every run
  if ! b2_upload_and_verify "$FILE" "database/daily/$BACKUP_NAME"; then
    B2_FAILED=1
    BACKUP_FAILED=1
  fi

  # Weekly backup — Sundays (day-of-week 7)
  if [[ "$(date +%u)" == "7" ]]; then
    if ! b2_upload_and_verify "$FILE" "database/weekly/$BACKUP_NAME"; then
      B2_FAILED=1
      BACKUP_FAILED=1
    fi
  fi

  # Monthly backup — 1st of each month
  if [[ "$(date +%d)" == "01" ]]; then
    if ! b2_upload_and_verify "$FILE" "database/monthly/$BACKUP_NAME"; then
      B2_FAILED=1
      BACKUP_FAILED=1
    fi
  fi

  if [[ "$B2_FAILED" -eq 0 ]]; then
    log "B2 database backup completed successfully"
  fi

else
  log "Backblaze B2 skipped (credentials not configured in $BACKUP_ENV_FILE)"
fi

# ---------------------------------------------------------------------------
# 3. Prune old local files
# ---------------------------------------------------------------------------
find "$BACKUP_DIR" -name '*.gz' -mtime +"$LOCAL_KEEP_DAYS" -delete

if [[ "$BACKUP_FAILED" -ne 0 ]]; then
  log "ERROR: backup completed with one or more failures"
  exit 1
fi
log "backup completed successfully"
log "BACKUP_RUN_SUCCESS id=$RUN_ID source=$RUN_SOURCE"

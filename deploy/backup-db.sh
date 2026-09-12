#!/usr/bin/env bash
# Nightly PostgreSQL backup with optional S3, Google Drive and Backblaze B2
# destinations. Cloudflare R2 customer documents may be copied to Google Drive,
# but are never copied to B2. Local and Google Drive DB dumps are kept 7 days;
# customer-document backups are never pruned by this script.
#
# Install as a cron job (runs 2:17 AM daily):
#   crontab -e
#   17 2 * * * /usr/bin/bash /home/ubuntu/jssf/deploy/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
#
# Google Drive: install rclone, run `rclone config` once to create a remote
# named "gdrive" (headless flow: answer No to auto-auth, run the printed
# `rclone authorize` command on your PC, paste the token back).
#
# R2 documents: create an rclone remote named "r2" pointing at your bucket:
#   rclone config create r2 s3 provider Cloudflare \
#     access_key_id YOUR_R2_ACCESS_KEY_ID \
#     secret_access_key YOUR_R2_SECRET_ACCESS_KEY \
#     endpoint https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com acl private
#   # verify:  rclone lsf r2:jssf-docs/customers | head
#
# Backblaze B2: credentials are loaded from ~/.config/jssf/backup.env. B2 is
# skipped unless B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY and B2_ENDPOINT exist.
set -euo pipefail

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$HOME/.config/jssf/backup.env}"
if [[ -f "$BACKUP_ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$BACKUP_ENV_FILE"
  set +a
fi

S3_BUCKET=""                        # e.g. "jssf-db-backups" — leave empty to skip S3
GDRIVE_REMOTE="gdrive:JSSF-Backups" # rclone remote:folder — leave empty to skip Drive
R2_DOCS="r2:jssf-docs/customers"    # rclone R2 remote:bucket/prefix — empty to skip docs
GDRIVE_KEEP_DAYS=7                  # DB dumps only — documents are kept forever
BACKUP_DIR="$HOME/backups"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/jssf_$STAMP.sql.gz"
RUN_LOG="$BACKUP_DIR/jssf_backup_$STAMP.log"

log() {
  local message
  message="$(date -Is) $*"
  echo "$message"
  echo "$message" >> "$RUN_LOG"
}

mkdir -p "$BACKUP_DIR"

log_exit_status() {
  local status=$?
  if [[ "$status" -ne 0 && "${FAILURE_LOGGED:-0}" -eq 0 ]]; then
    log "ERROR: backup failed with exit status $status"
  fi
}
trap log_exit_status EXIT
BACKUP_FAILED=0
FAILURE_LOGGED=0

sudo -u postgres pg_dump jssf | gzip > "$FILE"
gzip -t "$FILE"
log "wrote and validated $FILE ($(du -h "$FILE" | cut -f1))"

if [[ -n "$S3_BUCKET" ]]; then
  if aws s3 cp "$FILE" "s3://$S3_BUCKET/db/" --only-show-errors; then
    log "uploaded to s3://$S3_BUCKET"
  else
    log "ERROR: upload to s3://$S3_BUCKET failed"
    BACKUP_FAILED=1
  fi
fi

# Google Drive via rclone. Skipped silently if rclone/the remote isn't set up,
# so the local backup still succeeds either way.
if [[ -n "$GDRIVE_REMOTE" ]] && command -v rclone >/dev/null \
   && rclone listremotes | grep -q "^${GDRIVE_REMOTE%%:*}:$"; then
  # 1. Database dump -> db/  (pruned by age below)
  if rclone copy "$FILE" "$GDRIVE_REMOTE/db/" --quiet; then
    log "uploaded DB to $GDRIVE_REMOTE/db"
  else
    log "ERROR: Google Drive database upload failed"
    BACKUP_FAILED=1
  fi

  # 2. R2 customer documents -> documents/  (copy, never delete: filenames are
  #    unique UUIDs so unchanged files are skipped and nothing is ever removed).
  if [[ -n "$R2_DOCS" ]] && rclone listremotes | grep -q "^${R2_DOCS%%:*}:$"; then
    if rclone copy "$R2_DOCS" "$GDRIVE_REMOTE/documents/" --quiet; then
      log "synced R2 documents to $GDRIVE_REMOTE/documents"
    else
      log "ERROR: Google Drive customer-document sync failed"
      BACKUP_FAILED=1
    fi
  else
    log "R2 documents skipped (rclone 'r2' remote not configured)"
  fi

  # Prune old DB dumps ONLY — documents/ is intentionally never pruned.
  rclone delete "$GDRIVE_REMOTE/db" --min-age "${GDRIVE_KEEP_DAYS}d" --quiet || true
else
  log "Google Drive skipped (rclone not configured)"
fi

# Backblaze B2 uses its S3-compatible API and environment-only credentials.
# It stores database dumps and backup logs only; customer files remain in R2.
if [[ -n "${B2_BUCKET:-}" || -n "${B2_KEY_ID:-}" || -n "${B2_APPLICATION_KEY:-}" || -n "${B2_ENDPOINT:-}" ]]; then
  : "${B2_BUCKET:?B2_BUCKET is required when B2 backup is enabled}"
  : "${B2_KEY_ID:?B2_KEY_ID is required when B2 backup is enabled}"
  : "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY is required when B2 backup is enabled}"
  : "${B2_ENDPOINT:?B2_ENDPOINT is required when B2 backup is enabled}"
  command -v aws >/dev/null || { log "ERROR: aws CLI is required for B2 backup"; exit 1; }

  B2_ENDPOINT_HOST="${B2_ENDPOINT#https://}"
  B2_REGION="${B2_REGION:-${B2_ENDPOINT_HOST#s3.}}"
  B2_REGION="${B2_REGION%%.*}"

  b2_aws() {
    AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
    AWS_DEFAULT_REGION="$B2_REGION" \
      aws --endpoint-url "$B2_ENDPOINT" "$@"
  }

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
    log "uploaded and verified B2 object s3://$B2_BUCKET/$object_key ($remote_size bytes)"
  }

  BACKUP_NAME="${FILE##*/}"
  B2_FAILED=0
  if ! b2_upload_and_verify "$FILE" "database/daily/$BACKUP_NAME"; then
    B2_FAILED=1
    BACKUP_FAILED=1
  fi

  # Keep additional recovery points: Sunday is weekly; day 01 is monthly.
  if [[ "$(date +%u)" == "7" ]]; then
    if ! b2_upload_and_verify "$FILE" "database/weekly/$BACKUP_NAME"; then
      B2_FAILED=1
      BACKUP_FAILED=1
    fi
  fi
  if [[ "$(date +%d)" == "01" ]]; then
    if ! b2_upload_and_verify "$FILE" "database/monthly/$BACKUP_NAME"; then
      B2_FAILED=1
      BACKUP_FAILED=1
    fi
  fi

  if [[ "$B2_FAILED" -eq 0 ]]; then
    log "B2 database backup completed successfully"
  fi
  if ! b2_upload_and_verify "$RUN_LOG" "logs/jssf_backup_$STAMP.log"; then
    BACKUP_FAILED=1
  fi
else
  log "Backblaze B2 skipped (backup environment variables not configured)"
fi

# prune local copies older than 7 days
find "$BACKUP_DIR" -name '*.gz' -mtime +7 -delete
find "$BACKUP_DIR" -name 'jssf_backup_*.log' -mtime +30 -delete
if [[ "$BACKUP_FAILED" -ne 0 ]]; then
  FAILURE_LOGGED=1
  log "ERROR: backup completed with one or more destination failures"
  exit 1
fi
log "backup completed successfully"

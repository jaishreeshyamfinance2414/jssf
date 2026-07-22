#!/usr/bin/env bash
# Nightly backup of the Postgres database AND the Cloudflare R2 customer
# documents, pushed to Google Drive (rclone). Keeps 7 days of DB dumps locally
# and on Drive (pruned after GDRIVE_KEEP_DAYS), but document backups are NEVER
# pruned — every customer's documents are kept permanently.
#
# Install as a cron job (runs 2:17 AM daily):
#   crontab -e
#   17 2 * * * /home/ubuntu/jssf/deploy/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
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
set -euo pipefail

S3_BUCKET=""                        # e.g. "jssf-db-backups" — leave empty to skip S3
GDRIVE_REMOTE="gdrive:JSSF-Backups" # rclone remote:folder — leave empty to skip Drive
R2_DOCS="r2:jssf-docs/customers"    # rclone R2 remote:bucket/prefix — empty to skip docs
GDRIVE_KEEP_DAYS=7                  # DB dumps only — documents are kept forever
BACKUP_DIR="$HOME/backups"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/jssf_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump jssf | gzip > "$FILE"
echo "$(date -Is) wrote $FILE ($(du -h "$FILE" | cut -f1))"

if [[ -n "$S3_BUCKET" ]]; then
  aws s3 cp "$FILE" "s3://$S3_BUCKET/db/" --only-show-errors
  echo "$(date -Is) uploaded to s3://$S3_BUCKET"
fi

# Google Drive via rclone. Skipped silently if rclone/the remote isn't set up,
# so the local backup still succeeds either way.
if [[ -n "$GDRIVE_REMOTE" ]] && command -v rclone >/dev/null \
   && rclone listremotes | grep -q "^${GDRIVE_REMOTE%%:*}:$"; then
  # 1. Database dump -> db/  (pruned by age below)
  rclone copy "$FILE" "$GDRIVE_REMOTE/db/" --quiet
  echo "$(date -Is) uploaded DB to $GDRIVE_REMOTE/db"

  # 2. R2 customer documents -> documents/  (copy, never delete: filenames are
  #    unique UUIDs so unchanged files are skipped and nothing is ever removed).
  if [[ -n "$R2_DOCS" ]] && rclone listremotes | grep -q "^${R2_DOCS%%:*}:$"; then
    rclone copy "$R2_DOCS" "$GDRIVE_REMOTE/documents/" --quiet
    echo "$(date -Is) synced R2 documents to $GDRIVE_REMOTE/documents"
  else
    echo "$(date -Is) R2 documents skipped (rclone 'r2' remote not configured)"
  fi

  # Prune old DB dumps ONLY — documents/ is intentionally never pruned.
  rclone delete "$GDRIVE_REMOTE/db" --min-age "${GDRIVE_KEEP_DAYS}d" --quiet || true
else
  echo "$(date -Is) Google Drive skipped (rclone not configured)"
fi

# prune local copies older than 7 days
find "$BACKUP_DIR" -name '*.gz' -mtime +7 -delete

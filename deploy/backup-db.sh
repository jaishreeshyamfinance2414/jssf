#!/usr/bin/env bash
# Nightly Postgres backup. Keeps 14 days locally; optionally pushes to S3
# and/or Google Drive (rclone).
#
# Install as a cron job (runs 2:17 AM daily):
#   crontab -e
#   17 2 * * * /home/ubuntu/jssf/deploy/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
#
# To enable S3 upload: create a private bucket, attach an IAM role to the EC2
# instance with s3:PutObject on it, then set S3_BUCKET below.
#
# To enable Google Drive upload: install rclone (curl https://rclone.org/install.sh | sudo bash),
# run `rclone config` once to create a remote named "gdrive" (headless flow:
# answer No to auto-auth, run the printed `rclone authorize` command on your
# PC, paste the token back). Backups land in the JSSF-Backups folder and
# copies older than GDRIVE_KEEP_DAYS are pruned automatically.
set -euo pipefail

S3_BUCKET=""                        # e.g. "jssf-db-backups" — leave empty to skip S3
GDRIVE_REMOTE="gdrive:JSSF-Backups" # rclone remote:folder — leave empty to skip Drive
GDRIVE_KEEP_DAYS=15
BACKUP_DIR="$HOME/backups"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/jssf_$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump jssf | gzip > "$FILE"
echo "$(date -Is) wrote $FILE ($(du -h "$FILE" | cut -f1))"

# uploads (customer photos / documents) — sync alongside the DB dump
tar czf "$BACKUP_DIR/uploads_$STAMP.tar.gz" -C "$HOME/jssf/backend" uploads

if [[ -n "$S3_BUCKET" ]]; then
  aws s3 cp "$FILE" "s3://$S3_BUCKET/db/" --only-show-errors
  aws s3 cp "$BACKUP_DIR/uploads_$STAMP.tar.gz" "s3://$S3_BUCKET/uploads/" --only-show-errors
  echo "$(date -Is) uploaded to s3://$S3_BUCKET"
fi

# Google Drive via rclone: upload both archives, then prune old copies.
# Skipped silently if rclone isn't installed or the remote isn't configured,
# so the local backup still succeeds either way.
if [[ -n "$GDRIVE_REMOTE" ]] && command -v rclone >/dev/null \
   && rclone listremotes | grep -q "^${GDRIVE_REMOTE%%:*}:$"; then
  rclone copy "$FILE" "$GDRIVE_REMOTE/db/" --quiet
  rclone copy "$BACKUP_DIR/uploads_$STAMP.tar.gz" "$GDRIVE_REMOTE/uploads/" --quiet
  echo "$(date -Is) uploaded to $GDRIVE_REMOTE"
  rclone delete "$GDRIVE_REMOTE" --min-age "${GDRIVE_KEEP_DAYS}d" --quiet || true
  rclone rmdirs "$GDRIVE_REMOTE" --leave-root --quiet || true
else
  echo "$(date -Is) Google Drive skipped (rclone not configured)"
fi

# prune local copies older than 14 days
find "$BACKUP_DIR" -name '*.gz' -mtime +14 -delete

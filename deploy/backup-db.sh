#!/usr/bin/env bash
# Nightly Postgres backup. Keeps 14 days locally; optionally pushes to S3.
#
# Install as a cron job (runs 2:17 AM daily):
#   crontab -e
#   17 2 * * * /home/ubuntu/jssf/deploy/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
#
# To enable S3 upload: create a private bucket, attach an IAM role to the EC2
# instance with s3:PutObject on it, then set S3_BUCKET below.
set -euo pipefail

S3_BUCKET=""            # e.g. "jssf-db-backups" — leave empty to skip S3
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

# prune local copies older than 14 days
find "$BACKUP_DIR" -name '*.gz' -mtime +14 -delete

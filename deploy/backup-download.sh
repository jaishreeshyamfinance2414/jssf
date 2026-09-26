#!/usr/bin/env bash
# Download the newest daily PostgreSQL backup from Backblaze B2.
# This script only downloads the archive; it does not restore the database.
set -euo pipefail

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$HOME/.config/jssf/backup.env}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"

if [[ ! -f "$BACKUP_ENV_FILE" ]]; then
  echo "ERROR: B2 configuration file not found: $BACKUP_ENV_FILE" >&2
  exit 1
fi

command -v aws >/dev/null || {
  echo "ERROR: aws CLI is not installed." >&2
  exit 1
}

command -v gzip >/dev/null || {
  echo "ERROR: gzip is not installed." >&2
  exit 1
}

set -a
# shellcheck source=/dev/null
source "$BACKUP_ENV_FILE"
set +a

: "${B2_BUCKET:?B2_BUCKET is missing from $BACKUP_ENV_FILE}"
: "${B2_KEY_ID:?B2_KEY_ID is missing from $BACKUP_ENV_FILE}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY is missing from $BACKUP_ENV_FILE}"
: "${B2_ENDPOINT:?B2_ENDPOINT is missing from $BACKUP_ENV_FILE}"

B2_ENDPOINT_HOST="${B2_ENDPOINT#https://}"
B2_REGION="${B2_REGION:-${B2_ENDPOINT_HOST#s3.}}"
B2_REGION="${B2_REGION%%.*}"

b2_aws() {
  AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  AWS_DEFAULT_REGION="$B2_REGION" \
    aws --endpoint-url "$B2_ENDPOINT" "$@"
}

mkdir -p "$BACKUP_DIR"

LATEST_KEY="$(
  b2_aws s3api list-objects-v2 \
    --bucket "$B2_BUCKET" \
    --prefix 'database/daily/' \
    --query 'sort_by(Contents,&LastModified)[-1].Key' \
    --output text
)"

if [[ -z "$LATEST_KEY" || "$LATEST_KEY" == "None" ]]; then
  echo "ERROR: No daily backup was found in s3://$B2_BUCKET/database/daily/." >&2
  exit 1
fi

BACKUP_NAME="${LATEST_KEY##*/}"
DESTINATION="$BACKUP_DIR/$BACKUP_NAME"
TEMP_FILE="$DESTINATION.part"

trap 'rm -f -- "$TEMP_FILE"' EXIT

echo "Downloading s3://$B2_BUCKET/$LATEST_KEY"
b2_aws s3 cp \
  "s3://$B2_BUCKET/$LATEST_KEY" \
  "$TEMP_FILE" \
  --only-show-errors

gzip -t "$TEMP_FILE"
mv -f -- "$TEMP_FILE" "$DESTINATION"
trap - EXIT

echo "Downloaded and validated: $DESTINATION"

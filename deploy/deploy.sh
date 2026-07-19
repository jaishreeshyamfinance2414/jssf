#!/usr/bin/env bash
# Update the running app after uploading a new zip of the project.
#
# From your Windows machine:
#   1. Zip the project (exclude node_modules, .next, dist, uploads, .env)
#   2. scp -i your-key.pem jssf.zip ubuntu@YOUR_SERVER_IP:~
#   3. ssh in, then run:  bash ~/jssf/deploy/deploy.sh ~/jssf.zip
#
# Extracts the zip over ~/jssf (backend/.env and uploads/ are preserved),
# rebuilds, migrates, restarts.
set -euo pipefail

ZIP="${1:?Usage: bash deploy.sh <path-to-new-zip>}"
APP_DIR="$HOME/jssf"

echo "==> Extracting $ZIP"
TMP="$(mktemp -d)"
unzip -q "$ZIP" -d "$TMP"
# handle zips that contain a single top-level folder
SRC="$TMP"
if [[ "$(ls "$TMP" | wc -l)" == "1" && -d "$TMP/$(ls "$TMP")" ]]; then
  SRC="$TMP/$(ls "$TMP")"
fi
[[ -d "$SRC/backend" ]] || { echo "ERROR: zip doesn't contain backend/"; exit 1; }

# copy new code in; never overwrite .env or uploaded customer files
rsync -a --exclude 'backend/.env' --exclude 'backend/uploads' \
      --exclude 'node_modules' --exclude '.next' --exclude 'dist' \
      "$SRC/" "$APP_DIR/"
rm -rf "$TMP"

echo "==> Backend: install, build, migrate"
cd "$APP_DIR/backend"
npm ci
npm run build
npm run migrate

echo "==> Frontend: install, build"
cd "$APP_DIR/frontend"
npm ci
npm run build

echo "==> Restarting"
pm2 restart jssf-api jssf-web
pm2 save
echo "==> Done. Check: pm2 status && pm2 logs --lines 50"

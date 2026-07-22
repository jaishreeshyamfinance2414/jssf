#!/usr/bin/env bash
# ============================================================
# JSSF one-time server setup — run ON the EC2 instance as ubuntu
#
# First upload and extract the project zip so the code lives at
# ~/jssf (i.e. ~/jssf/backend, ~/jssf/frontend, ~/jssf/deploy),
# then run:
#
#   bash ~/jssf/deploy/setup-server.sh yourdomain.com
#
# Installs Node 22, PostgreSQL, nginx, pm2; creates the database; builds;
# migrates + seeds; starts the app under pm2; configures nginx + HTTPS
# using a Cloudflare Origin certificate (see step 8 below).
# ============================================================
set -euo pipefail

DOMAIN="${1:?Usage: bash setup-server.sh <domain>}"
APP_DIR="$HOME/jssf"
DB_NAME="jssf"
DB_USER="jssf"

echo "==> [1/8] System packages"
sudo apt-get update -y
sudo apt-get install -y curl git unzip rsync nginx postgresql postgresql-contrib

echo "==> [2/8] Node.js 22 LTS + pm2"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm install -g pm2

echo "==> [3/8] PostgreSQL database + user"
DB_PASS="$(openssl rand -hex 24)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}'"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER}"

echo "==> [4/8] Verify project files"
if [[ ! -d "$APP_DIR/backend" || ! -d "$APP_DIR/frontend" ]]; then
  echo "ERROR: expected project at $APP_DIR (with backend/ and frontend/)."
  echo "Upload the zip, extract it, and make sure the folders sit directly"
  echo "under ~/jssf — e.g.:  unzip jssf.zip -d ~ && mv ~/<extracted> ~/jssf"
  exit 1
fi

echo "==> [5/8] Backend .env"
if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  cat > "$APP_DIR/backend/.env" <<EOF
NODE_ENV=production
PORT=4000
API_PREFIX=/api/v1

DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
PG_POOL_MAX=10
PGSSLMODE=disable

JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
JWT_REFRESH_TTL_REMEMBER=30d

MAX_LOGIN_ATTEMPTS=5
TRUST_PROXY=true
CORS_ORIGIN=https://${DOMAIN}
COOKIE_DOMAIN=
COOKIE_SECURE=true

UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=5

SEED_ADMIN_EMAIL=admin@jaishrishyamfinance.com
SEED_ADMIN_MOBILE=9821417166
SEED_ADMIN_PASSWORD=Redmi@63427258
EOF
  echo "    backend/.env written (DB password + JWT secrets generated)"
else
  echo "    backend/.env already exists — leaving it untouched"
fi

echo "==> [6/8] Install, build, migrate, seed"
cd "$APP_DIR/backend"
npm ci
npm run build
npm run seed          # runs migrate first, then seeds roles/permissions/admin
mkdir -p uploads

cd "$APP_DIR/frontend"
npm ci
npm run build

echo "==> [7/8] Start app under pm2"
cd "$APP_DIR"
pm2 start deploy/ecosystem.config.js
pm2 save
# auto-start pm2 on reboot
sudo env PATH=$PATH pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "==> [8/8] nginx + Cloudflare Origin certificate"
# Install the Cloudflare Origin cert. Generate it once in the Cloudflare
# dashboard (SSL/TLS -> Origin Server -> Create Certificate) and save the two
# PEM blocks here BEFORE running this script:
#   $APP_DIR/deploy/cloudflare/origin.crt   (the "Origin Certificate")
#   $APP_DIR/deploy/cloudflare/origin.key   (the "Private Key")
# Also set the Cloudflare SSL/TLS mode to "Full (strict)".
CF_SRC="$APP_DIR/deploy/cloudflare"
CF_DST="/etc/ssl/cloudflare"
if [[ ! -f "$CF_SRC/origin.crt" || ! -f "$CF_SRC/origin.key" ]]; then
  echo "ERROR: Cloudflare Origin cert not found."
  echo "In Cloudflare: SSL/TLS -> Origin Server -> Create Certificate, then save"
  echo "the two PEM blocks as:"
  echo "  $CF_SRC/origin.crt   and   $CF_SRC/origin.key"
  exit 1
fi
sudo mkdir -p "$CF_DST"
sudo cp "$CF_SRC/origin.crt" "$CF_DST/jssf.crt"
sudo cp "$CF_SRC/origin.key" "$CF_DST/jssf.key"
sudo chmod 600 "$CF_DST/jssf.key"

sudo sed "s/YOUR_DOMAIN/${DOMAIN}/g" "$APP_DIR/deploy/nginx-jssf.conf" \
  | sudo tee /etc/nginx/sites-available/jssf >/dev/null
sudo ln -sf /etc/nginx/sites-available/jssf /etc/nginx/sites-enabled/jssf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "============================================================"
echo " DONE. App is live at: https://${DOMAIN}"
echo ""
echo " Login: admin@jssf.local / Admin@123  — CHANGE THIS NOW."
echo " DB password + JWT secrets are in ~/jssf/backend/.env"
echo ""
echo " Update later:   cd ~/jssf && bash deploy/deploy.sh"
echo " Logs:           pm2 logs"
echo "============================================================"

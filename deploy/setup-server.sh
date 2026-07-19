#!/usr/bin/env bash
# ============================================================
# JSSF one-time server setup — run ON the EC2 instance as ubuntu
#
# First upload and extract the project zip so the code lives at
# ~/jssf (i.e. ~/jssf/backend, ~/jssf/frontend, ~/jssf/deploy),
# then run:
#
#   bash ~/jssf/deploy/setup-server.sh yourdomain.com you@email.com
#
# Installs Node 22, PostgreSQL, nginx, pm2, certbot; creates the
# database; builds; migrates + seeds; starts the app under pm2;
# configures nginx + HTTPS.
# ============================================================
set -euo pipefail

DOMAIN="${1:?Usage: bash setup-server.sh <domain> <email>}"
EMAIL="${2:?Usage: bash setup-server.sh <domain> <email>}"
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

SEED_ADMIN_EMAIL=admin@jssf.local
SEED_ADMIN_MOBILE=9999999999
SEED_ADMIN_PASSWORD=Admin@123
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

echo "==> [8/8] nginx + HTTPS"
sudo sed "s/YOUR_DOMAIN/${DOMAIN}/g" "$APP_DIR/deploy/nginx-jssf.conf" \
  | sudo tee /etc/nginx/sites-available/jssf >/dev/null
sudo ln -sf /etc/nginx/sites-available/jssf /etc/nginx/sites-enabled/jssf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo snap install --classic certbot 2>/dev/null || true
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d "${DOMAIN}" -m "${EMAIL}" --agree-tos --no-eff-email --redirect

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

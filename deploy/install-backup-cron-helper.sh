#!/usr/bin/env bash
# Run during deployment as the PM2 owner (with sudo rights).
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ "$APP_DIR" =~ ^/[A-Za-z0-9/._-]+$ ]] || { echo 'App path must not contain spaces or shell characters' >&2; exit 1; }
[[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
[[ "$APP_HOME" =~ ^/[A-Za-z0-9/._-]+$ ]] || exit 1

sudo install -o root -g root -m 0755 "$APP_DIR/deploy/manage-backup-cron.sh" /usr/local/sbin/jssf-backup-cron
sudo install -d -o root -g root -m 0755 /usr/local/libexec/jssf
sudo install -o root -g root -m 0755 "$APP_DIR/deploy/backup-db.sh" /usr/local/libexec/jssf/backup-db.sh
sudo install -o root -g root -m 0755 "$APP_DIR/deploy/run-managed-backup.sh" /usr/local/libexec/jssf/run-backup.sh
sudo install -d -o root -g root -m 0755 /etc/jssf
{ printf 'BACKUP_SCRIPT=/usr/local/libexec/jssf/backup-db.sh\n'; printf 'LEGACY_SCRIPT=%q\n' "$APP_DIR/deploy/backup-db.sh"; printf 'APP_HOME=%q\n' "$APP_HOME"; } | sudo tee /etc/jssf/backup-cron.conf >/dev/null
sudo chown root:root /etc/jssf/backup-cron.conf
sudo chmod 0644 /etc/jssf/backup-cron.conf
if [[ -f "$APP_HOME/.config/jssf/backup.env" ]]; then
  sudo install -o root -g root -m 0600 "$APP_HOME/.config/jssf/backup.env" /etc/jssf/backup.env
fi
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/jssf-backup-cron\n' "$APP_USER" | sudo tee /etc/sudoers.d/jssf-backup-cron >/dev/null
sudo chmod 0440 /etc/sudoers.d/jssf-backup-cron
sudo visudo -cf /etc/sudoers.d/jssf-backup-cron >/dev/null

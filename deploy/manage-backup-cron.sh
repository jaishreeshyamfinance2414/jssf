#!/usr/bin/env bash
# Root-owned, narrowly scoped helper invoked by the API through sudo.
# It only manages the JSSF database-backup entry in root's crontab.
set -euo pipefail

CONFIG=/etc/jssf/backup-cron.conf
[[ "$(id -u)" -eq 0 ]] || { echo 'Must run as root' >&2; exit 1; }
[[ -r "$CONFIG" ]] || { echo 'Backup cron helper is not configured' >&2; exit 1; }
# Root owns this file; the web process cannot change the script or log path.
# shellcheck source=/dev/null
source "$CONFIG"
[[ "$BACKUP_SCRIPT" =~ ^/[A-Za-z0-9/._-]+$ && -f "$BACKUP_SCRIPT" ]] || { echo 'Invalid backup script path' >&2; exit 1; }
[[ "$LEGACY_SCRIPT" =~ ^/[A-Za-z0-9/._-]+$ ]] || exit 1
[[ "$APP_HOME" =~ ^/[A-Za-z0-9/._-]+$ ]] || exit 1

BEGIN_MARK='# BEGIN JSSF MANAGED BACKUP'
END_MARK='# END JSSF MANAGED BACKUP'
current="$(crontab -l 2>/dev/null || true)"
managed="$(printf '%s\n' "$current" | sed -n "/^${BEGIN_MARK}$/,/^${END_MARK}$/p" | sed -n '2p')"
legacy="$(printf '%s\n' "$current" | grep -F "/usr/bin/bash $LEGACY_SCRIPT" | head -n 1 || true)"

case "${1:-}" in
  status)
    line="${managed:-$legacy}"
    state=enabled
    if [[ "$line" == '# '* ]]; then state=disabled; line="${line#\# }"; fi
    if [[ "$line" =~ ^([0-9]+)[[:space:]]+([0-9]+)[[:space:]]+\*[[:space:]]+\*[[:space:]]+\* ]]; then
      printf '%s\t%02d:%02d\t%s\t%s\n' "$state" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[1]}))" "$BACKUP_SCRIPT" "$(date +%Z)"
    else
      printf 'disabled\t02:17\t%s\t%s\n' "$BACKUP_SCRIPT" "$(date +%Z)"
    fi
    ;;
  last-run)
    if [[ -r /var/lib/jssf/backup-status.tsv ]]; then
      cat /var/lib/jssf/backup-status.tsv
    else
      # Before the managed wrapper's first run, use the backup script's
      # existing per-run logs, including logs from the older manual cron.
      latest="$(find /root/backups "$APP_HOME/backups" -maxdepth 1 -type f -name 'jssf_backup_*.log' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
      if [[ -n "$latest" ]]; then
        last="$(tail -n 1 "$latest")"
        finished="$(date -u -d "${last%% *}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$latest" +%Y-%m-%dT%H:%M:%SZ)"
        if [[ "$last" == *'backup completed successfully'* ]]; then
          printf 'success\t-\t%s\t-\n' "$finished"
        elif [[ "$last" == *'ERROR:'* ]]; then
          error="$(grep 'ERROR:' "$latest" | tail -n 4 | head -c 2000 | base64 -w0)"
          printf 'failed\t-\t%s\t%s\n' "$finished" "$error"
        else
          printf 'unknown\t-\t%s\t-\n' "$finished"
        fi
      else
        printf 'never\t-\t-\t-\n'
      fi
    fi
    ;;
  set)
    [[ "$#" -eq 4 && ( "$2" == enabled || "$2" == disabled ) ]] || exit 2
    [[ "$3" =~ ^([01]?[0-9]|2[0-3])$ && "$4" =~ ^([0-5]?[0-9])$ ]] || exit 2
    hour=$((10#$3)); minute=$((10#$4))
    # Preserve every unrelated root cron entry. Remove any earlier JSSF
    # managed block and the documented pre-UI line for this exact script.
    filtered="$(printf '%s\n' "$current" | sed "/^${BEGIN_MARK}$/,/^${END_MARK}$/d" | grep -Fv -- "/usr/bin/bash $BACKUP_SCRIPT" | grep -Fv -- "/usr/bin/bash $LEGACY_SCRIPT" || true)"
    {
      printf '%s\n' "$filtered"
      printf '%s\n' "$BEGIN_MARK"
      [[ "$2" == enabled ]] || printf '# '
      printf '%d %d * * * HOME=/root BACKUP_ENV_FILE=/etc/jssf/backup.env /usr/bin/bash /usr/local/libexec/jssf/run-backup.sh >> /var/log/jssf-backup.log 2>&1\n' "$minute" "$hour"
      printf '%s\n' "$END_MARK"
    } | crontab -
    "$0" status
    ;;
  *) exit 2 ;;
esac

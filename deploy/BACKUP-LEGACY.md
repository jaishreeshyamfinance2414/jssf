# Legacy Backup Script — Google Drive + rclone

## What is `backup-db-gdrive.sh`?

This is an **unmodified archive** of the original `backup-db.sh` script, saved on
**12 September 2026** before the backup strategy was simplified.

## Why was it archived?

The original script supported three off-server backup destinations:

| Destination      | Tool    | What it backed up                 |
|------------------|---------|-----------------------------------|
| AWS S3           | aws CLI | Database dumps (optional, unused) |
| Google Drive     | rclone  | Database dumps + R2 customer docs |
| Backblaze B2     | aws CLI | Database dumps + logs             |

**Google Drive was removed** because:
1. Google OAuth tokens required periodic re-authorization on a headless server.
2. The Google API moved to a paid tier after the free quota was consumed.
3. Both Cloudflare R2 and Backblaze B2 use the standard S3 API, so the AWS CLI
   handles everything — rclone was only needed for Google Drive.

## Current backup strategy (September 2026)

| Data             | Primary Storage   | Backup Destination | Tool    |
|------------------|-------------------|--------------------|---------|
| Customer docs    | Cloudflare R2     | *(R2 is the primary store itself)* | App backend |
| Database (app data) | PostgreSQL on EC2 | Backblaze B2       | aws CLI |
| Backup logs      | Local disk        | Backblaze B2       | aws CLI |

The current `backup-db.sh` uses **only the AWS CLI** — no rclone, no Google
Drive, no S3.

## How to restore Google Drive backup (if ever needed)

1. Install rclone on the server:
   ```bash
   sudo apt install rclone
   ```

2. Configure a Google Drive remote (headless flow):
   ```bash
   rclone config
   # Create a new remote named "gdrive"
   # Type: Google Drive
   # Answer "No" to auto-auth, run the printed `rclone authorize` on your PC,
   # paste the token back into the server terminal.
   ```

3. Configure an R2 remote for customer document sync:
   ```bash
   rclone config create r2 s3 provider Cloudflare \
     access_key_id YOUR_R2_ACCESS_KEY_ID \
     secret_access_key YOUR_R2_SECRET_ACCESS_KEY \
     endpoint https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com acl private
   ```

4. Replace the active script with the archived one:
   ```bash
   cp ~/jssf/deploy/backup-db-gdrive.sh ~/jssf/deploy/backup-db.sh
   ```

5. Test:
   ```bash
   bash -n ~/jssf/deploy/backup-db.sh
   /usr/bin/bash ~/jssf/deploy/backup-db.sh
   ```

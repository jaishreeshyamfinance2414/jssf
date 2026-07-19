# JSSF — AWS Deployment Guide (EC2, no Docker)

Everything runs on one Ubuntu EC2 instance: PostgreSQL, the Express API (pm2),
the Next.js frontend (pm2), and nginx in front with free HTTPS (Let's Encrypt).

```
Internet → nginx (443)
             ├─ /api/v1/*  → Express API  :4000
             └─ /*         → Next.js      :3000
                                └─ PostgreSQL :5432 (localhost only)
```

Cost: a `t3.small` (2 GB RAM) is ~$15/mo in ap-south-1 (Mumbai). Don't use
`t3.micro`/free tier — 1 GB RAM is not enough to build Next.js.

---

## Step 1 — Launch the EC2 instance (AWS Console)

1. Log in to AWS Console → set region to **ap-south-1 (Mumbai)** (top-right).
2. Go to **EC2 → Launch instance** and set:
   - **Name:** `jssf-prod`
   - **AMI:** Ubuntu Server 24.04 LTS (64-bit x86)
   - **Instance type:** `t3.small`
   - **Key pair:** Create new → name `jssf-key` → type RSA, format `.pem` →
     **download and keep the file safe** (you cannot download it again).
   - **Network settings → Edit:** allow **SSH (22)**, **HTTP (80)**, **HTTPS (443)**.
     For SSH, choose "My IP" instead of Anywhere if your IP is stable.
   - **Storage:** 30 GB gp3.
3. Launch, wait until state = Running.
4. **Allocate a fixed IP:** EC2 → Elastic IPs → Allocate → then
   **Actions → Associate** it with `jssf-prod`. Note this IP — without an
   Elastic IP the address changes on every reboot and your domain breaks.

## Step 2 — Point your domain at the server

At your domain registrar's DNS panel, add:

| Type | Name/Host | Value |
|------|-----------|-------|
| A | `@` (or the subdomain, e.g. `app`) | your Elastic IP |

Wait until `nslookup yourdomain.com` returns the Elastic IP (usually minutes,
can take up to an hour). **HTTPS setup in Step 4 will fail until DNS resolves.**

## Step 3 — Upload the code

On your Windows machine, in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\make-zip.ps1
scp -i path\to\jssf-key.pem ..\jssf.zip ubuntu@YOUR_ELASTIC_IP:~
```

Then SSH in and extract:

```bash
ssh -i path\to\jssf-key.pem ubuntu@YOUR_ELASTIC_IP
unzip -q jssf.zip -d jssf     # code must end up at ~/jssf/backend etc.
```

## Step 4 — Run the setup script

```bash
bash ~/jssf/deploy/setup-server.sh yourdomain.com your@email.com
```

This takes ~10 minutes and does everything: installs Node 22 / PostgreSQL /
nginx / pm2, creates the database with a random password, writes
`backend/.env` with generated JWT secrets, builds both apps, runs migrations
and seed, starts everything under pm2 (with restart-on-reboot), and gets the
HTTPS certificate.

When it finishes: **https://yourdomain.com** is live.

## Step 5 — Immediately after going live

1. Log in as `admin@jssf.local` / `Admin@123` and **change the password**.
2. Change/disable the seeded agent accounts (`Agent@123`) too.
3. Set up nightly backups (finance data — do not skip):
   ```bash
   crontab -e
   # add this line:
   17 2 * * * /home/ubuntu/jssf/deploy/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
   ```
   For off-server copies, create a private S3 bucket, attach an IAM role with
   `s3:PutObject` to the instance, and set `S3_BUCKET` in `deploy/backup-db.sh`.

---

## Releasing updates later

```powershell
# on Windows: rebuild the zip and upload
powershell -ExecutionPolicy Bypass -File deploy\make-zip.ps1
scp -i path\to\jssf-key.pem ..\jssf.zip ubuntu@YOUR_ELASTIC_IP:~
```
```bash
# on the server: extract-over, rebuild, migrate, restart (keeps .env + uploads)
bash ~/jssf/deploy/deploy.sh ~/jssf.zip
```

## Useful commands on the server

| What | Command |
|------|---------|
| App status | `pm2 status` |
| Live logs | `pm2 logs` |
| Restart apps | `pm2 restart jssf-api jssf-web` |
| DB console | `sudo -u postgres psql jssf` |
| nginx logs | `sudo tail -f /var/log/nginx/error.log` |
| Renew HTTPS | automatic (certbot timer); test with `sudo certbot renew --dry-run` |

## Troubleshooting

- **502 Bad Gateway** — an app is down: `pm2 status`, then `pm2 logs`.
- **certbot failed** — DNS not propagated yet. Wait, then re-run:
  `sudo certbot --nginx -d yourdomain.com`.
- **Frontend build killed on server** — instance too small; use `t3.small`+,
  or add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`.
- **Login works but session drops** — check `TRUST_PROXY=true` and
  `COOKIE_SECURE=true` in `backend/.env` (the setup script sets both).

# JSSF — AWS Deployment Guide (EC2, no Docker)

Everything runs on one Ubuntu EC2 instance: PostgreSQL, the Express API (pm2),
the Next.js frontend (pm2), and nginx in front. Cloudflare sits in front of the
server (DNS proxied, orange cloud) and terminates public HTTPS; nginx holds a
Cloudflare **Origin certificate** for the Cloudflare↔server leg. Customer
documents (photos, Aadhaar, PAN, signatures) are stored in **Cloudflare R2**,
not on the server disk.

```
Browser → Cloudflare edge (public HTTPS)
             → nginx (443, Cloudflare Origin cert)
                 ├─ /api/v1/*  → Express API  :4000  → R2 (documents)
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

## Step 2 — Point your domain at Cloudflare

Your domain is on Cloudflare. In the Cloudflare dashboard:

1. **DNS → Records:** add an `A` record — Name `@` (or a subdomain), Value your
   Elastic IP, **Proxy status: Proxied (orange cloud)**.
2. **SSL/TLS → Overview:** set the mode to **Full (strict)**. (Not "Flexible" —
   that leaves the origin leg unencrypted and causes redirect loops.)
3. **SSL/TLS → Origin Server → Create Certificate** → accept the defaults (RSA,
   15-year, `yourdomain.com` + `*.yourdomain.com`) → **Create**. Copy the two
   PEM blocks and save them on the server BEFORE Step 4:
   - Origin Certificate → `~/jssf/deploy/cloudflare/origin.crt`
   - Private Key → `~/jssf/deploy/cloudflare/origin.key` (shown only once)
4. **SSL/TLS → Edge Certificates:** turn on **Always Use HTTPS** and
   **Automatic HTTPS Rewrites**.

The public certificate visitors see is Cloudflare's edge cert (automatic). The
Origin cert above is only trusted by Cloudflare, which is all the origin needs.

5. **R2 → your bucket → Settings → Object lifecycle rules → Add rule:** delete
   objects with prefix `staging/` after **1 day**. On the Create Customer form
   each document uploads immediately to `staging/` and is committed to
   `customers/` on save (or deleted if the form is cancelled). This rule sweeps
   anything left behind when a browser tab is hard-closed mid-form.

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

The app stores documents in R2, so export your R2 credentials first (create a
token under **R2 → Manage API Tokens → Object Read & Write**):

```bash
export R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
export R2_BUCKET=jssf-docs
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...

bash ~/jssf/deploy/setup-server.sh yourdomain.com
```

This takes ~10 minutes and does everything: installs Node 22 / PostgreSQL /
nginx / pm2, creates the database with a random password, writes
`backend/.env` with generated JWT secrets + your R2 credentials, builds both
apps, runs migrations and seed, starts everything under pm2 (with
restart-on-reboot), and installs the Cloudflare Origin cert from
`deploy/cloudflare/` into nginx.

When it finishes: **https://yourdomain.com** is live (through Cloudflare).

## Step 5 — Immediately after going live

1. Log in as `admin@jssf.local` / `Admin@123` and **change the password**.
2. Change/disable the seeded agent accounts (`Agent@123`) too.
3. Set up nightly database backups (finance data — do not skip):
   ```bash
   crontab -e
   # add this line:
   17 2 * * * /home/ubuntu/jssf/deploy/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
   ```
   For off-server copies, either create a private S3 bucket + IAM role with
   `s3:PutObject` and set `S3_BUCKET`, or configure an rclone `gdrive` remote,
   in `deploy/backup-db.sh`. Customer documents are **not** in this backup —
   they live in R2, which is already durable, replicated storage.

---

## Releasing updates later

```powershell
# on Windows: rebuild the zip and upload
powershell -ExecutionPolicy Bypass -File deploy\make-zip.ps1
scp -i path\to\jssf-key.pem ..\jssf.zip ubuntu@YOUR_ELASTIC_IP:~
```
```bash
# on the server: extract-over, rebuild, migrate, restart (keeps .env)
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
| HTTPS cert | Cloudflare Origin cert, valid 15 years — no renewal needed |

## Troubleshooting

- **502 Bad Gateway** — an app is down: `pm2 status`, then `pm2 logs`.
- **"Web server is down" (Cloudflare error 521)** — nginx isn't serving 443.
  Check `sudo nginx -t` and `sudo ss -tlnp | grep 443`. Usually the Origin cert
  files are missing from `/etc/ssl/cloudflare/` or the config failed to load.
- **Redirect loop / ERR_TOO_MANY_REDIRECTS** — Cloudflare SSL mode is set to
  "Flexible"; change it to **Full (strict)**.
- **Documents fail to load / upload** — check the `R2_*` values in
  `backend/.env` and `pm2 logs jssf-api` for R2 errors (403 = bad token/bucket).
- **Frontend build killed on server** — instance too small; use `t3.small`+,
  or add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`.
- **Login works but session drops** — check `TRUST_PROXY=true` and
  `COOKIE_SECURE=true` in `backend/.env` (the setup script sets both).

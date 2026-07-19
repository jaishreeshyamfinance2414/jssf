-- Force-change-on-first-login support: seeded/admin-reset accounts must set
-- their own password before using the app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Backfill: accounts created by earlier seeds (well-known default passwords)
-- must rotate on their next login.
UPDATE users SET must_change_password = true
 WHERE email IN ('admin@jssf.local', 'agent1@jssf.local', 'agent2@jssf.local');

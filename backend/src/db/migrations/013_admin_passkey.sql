-- Admin passkey: a single 4-digit PIN (argon2-hashed) that must accompany
-- sensitive admin actions. Set/reset only via `npm run passkey` on the server
-- shell — there is deliberately no API to change it.
CREATE TABLE admin_passkey (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hash            text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

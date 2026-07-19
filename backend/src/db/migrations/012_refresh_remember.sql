-- Persist the "remember me" choice per refresh token so rotation keeps the
-- original session lifetime (30d remember vs 7d default) instead of silently
-- shrinking every session to the default TTL on first refresh.
ALTER TABLE refresh_tokens ADD COLUMN remember boolean NOT NULL DEFAULT false;

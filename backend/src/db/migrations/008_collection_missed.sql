-- 008: Daily-entry flow — "missed" collection entries.
--
-- Every active loan gets an entry per EMI day: cash/UPI money entries, or a
-- zero-amount 'missed' entry (recorded by the agent or the auto-sweep) when
-- nothing was collected. Requires relaxing the amount CHECK to allow 0.

ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'missed';

ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_amount_check;
ALTER TABLE collections ADD CONSTRAINT collections_amount_check CHECK (amount >= 0);

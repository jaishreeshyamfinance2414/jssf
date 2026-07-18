-- 009: Missed-EMI penalty accrual.
--
-- When an EMI day is missed, a penalty (settings.penalty.per_day_pct % of the
-- EMI amount) is added to that EMI's due_amount and to the loan's
-- total_payable. missed_penalty records how much was added so an admin
-- correction (deleting a wrong "missed" entry) can reverse it exactly.

ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS missed_penalty numeric(14,2) NOT NULL DEFAULT 0;

-- Indexes used by the hourly statement/penalty sweep and immediate
-- reconciliation after an admin changes a payment.

CREATE INDEX IF NOT EXISTS idx_collections_emi_id
  ON collections(emi_id);

CREATE INDEX IF NOT EXISTS idx_collections_loan_entry_date
  ON collections(loan_id, entry_date);

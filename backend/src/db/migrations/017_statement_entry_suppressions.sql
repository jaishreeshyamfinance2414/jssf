-- 017: Keep an admin-deleted automatic advance/on-time statement row deleted.
-- The sweep derives these rows again every hour, so deletion needs a durable
-- tombstone for the EMI rather than relying on the absence of the collection.

CREATE TABLE IF NOT EXISTS statement_entry_suppressions (
  emi_id         uuid PRIMARY KEY REFERENCES emi_schedule(id) ON DELETE CASCADE,
  loan_id        uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  suppressed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_statement_suppressions_loan
  ON statement_entry_suppressions(loan_id);

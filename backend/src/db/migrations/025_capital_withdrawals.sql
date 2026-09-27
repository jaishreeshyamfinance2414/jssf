-- Capital returned to an owner is a debit from the selected cash/bank account.
-- Keep it separate from capital introductions so both flows retain their own
-- dates and audit trail.

ALTER TYPE ledger_source ADD VALUE IF NOT EXISTS 'capital_withdrawal';

CREATE TABLE IF NOT EXISTS capital_withdrawals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  withdrawal_date date NOT NULL DEFAULT CURRENT_DATE,
  note            text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_withdrawals_account
  ON capital_withdrawals(account_id);
CREATE INDEX IF NOT EXISTS idx_capital_withdrawals_date
  ON capital_withdrawals(withdrawal_date);

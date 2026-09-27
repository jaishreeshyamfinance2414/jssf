-- Loans taken by the business are liabilities, distinct from owner capital.

ALTER TYPE ledger_source ADD VALUE IF NOT EXISTS 'borrowed_loan';
ALTER TYPE ledger_source ADD VALUE IF NOT EXISTS 'borrowed_loan_payment';

CREATE TABLE IF NOT EXISTS borrowed_loans (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lender_name             text NOT NULL,
  loan_type               text NOT NULL CHECK (loan_type IN ('reducing_balance','interest_only')),
  receiving_account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  original_principal      numeric(14,2) NOT NULL CHECK (original_principal > 0),
  installment_count       int CHECK (installment_count > 0),
  installment_amount      numeric(14,2) CHECK (installment_amount > 0),
  total_payable           numeric(14,2) CHECK (total_payable > 0),
  total_interest          numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_interest >= 0),
  periodic_interest       numeric(14,2) CHECK (periodic_interest > 0),
  received_date           date NOT NULL,
  first_payment_date      date NOT NULL,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  note                    text,
  created_by              uuid REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (first_payment_date >= received_date),
  CHECK (
    (loan_type = 'reducing_balance' AND installment_count IS NOT NULL
      AND installment_amount IS NOT NULL AND total_payable IS NOT NULL)
    OR
    (loan_type = 'interest_only' AND periodic_interest IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS borrowed_loan_schedule (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id           uuid NOT NULL REFERENCES borrowed_loans(id) ON DELETE CASCADE,
  installment_no    int NOT NULL CHECK (installment_no > 0),
  due_date          date NOT NULL,
  principal_due     numeric(14,2) NOT NULL CHECK (principal_due >= 0),
  interest_due      numeric(14,2) NOT NULL CHECK (interest_due >= 0),
  total_due         numeric(14,2) NOT NULL CHECK (total_due > 0),
  paid_at           date,
  UNIQUE (loan_id, installment_no)
);

CREATE TABLE IF NOT EXISTS borrowed_loan_payments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id           uuid NOT NULL REFERENCES borrowed_loans(id) ON DELETE RESTRICT,
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  schedule_id       uuid REFERENCES borrowed_loan_schedule(id) ON DELETE RESTRICT,
  payment_date      date NOT NULL,
  principal_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
  interest_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  total_amount      numeric(14,2) NOT NULL CHECK (total_amount > 0),
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_borrowed_loans_status ON borrowed_loans(status);
CREATE INDEX IF NOT EXISTS idx_borrowed_schedule_due ON borrowed_loan_schedule(due_date, paid_at);
CREATE INDEX IF NOT EXISTS idx_borrowed_payments_loan ON borrowed_loan_payments(loan_id, payment_date);

DROP TRIGGER IF EXISTS trg_borrowed_loans_updated ON borrowed_loans;
CREATE TRIGGER trg_borrowed_loans_updated BEFORE UPDATE ON borrowed_loans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

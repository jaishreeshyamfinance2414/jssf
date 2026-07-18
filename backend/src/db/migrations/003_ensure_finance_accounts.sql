-- Defensive repair migration for databases that were seeded before the
-- finance-account migration existed, or whose _migrations table got out of
-- sync. Everything here is idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE account_type AS ENUM ('cash','bank');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_direction') THEN
    CREATE TYPE ledger_direction AS ENUM ('credit','debit');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_source') THEN
    CREATE TYPE ledger_source AS ENUM (
      'capital','collection','agent_submission','loan_disbursement','expense','salary','adjustment'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'capital_source_type') THEN
    CREATE TYPE capital_source_type AS ENUM ('owner_capital','external_loan','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'emi_frequency') THEN
    CREATE TYPE emi_frequency AS ENUM ('daily','weekly','monthly');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  type         account_type NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_branch_type_active
  ON accounts(branch_id, type) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_accounts_updated ON accounts;
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS account_transactions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  direction    ledger_direction NOT NULL,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  source       ledger_source NOT NULL,
  reference_id uuid,
  description  text,
  txn_date     date NOT NULL DEFAULT CURRENT_DATE,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_txn_account ON account_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_account_txn_account_date ON account_transactions(account_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_account_txn_source ON account_transactions(source, reference_id);

CREATE TABLE IF NOT EXISTS capital_entries (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id        uuid REFERENCES branches(id) ON DELETE SET NULL,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  source_type      capital_source_type NOT NULL DEFAULT 'owner_capital',
  contributor_name text NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  entry_date       date NOT NULL DEFAULT CURRENT_DATE,
  note             text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_entries_account ON capital_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_capital_entries_date ON capital_entries(entry_date);

ALTER TABLE loans ADD COLUMN IF NOT EXISTS emi_frequency emi_frequency NOT NULL DEFAULT 'monthly';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS tenure_count int NOT NULL DEFAULT 1 CHECK (tenure_count > 0);

ALTER TABLE salaries ADD COLUMN IF NOT EXISTS payment_mode payment_mode NOT NULL DEFAULT 'cash';

ALTER TABLE collections ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS agent_ledger_id uuid REFERENCES agent_ledger(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_collections_reconcile ON collections(agent_id, mode, reconciled_at);

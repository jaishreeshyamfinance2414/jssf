-- ============================================================================
--  JAI SHREE SHYAM FINANCE — Initial schema
--  Normalized, foreign-keyed, indexed. Money stored as NUMERIC(14,2).
--  branch_id is present everywhere business data lives so Multi-Branch is a
--  data change, not a migration that breaks existing rows.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Auto-update updated_at on any row change.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────── Org / Branch (future-ready) ───────────────────
CREATE TABLE branches (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  code         text UNIQUE NOT NULL,
  address      text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────── RBAC: roles / permissions ─────────────────────
CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text UNIQUE NOT NULL,            -- 'admin' | 'manager' | 'collection_agent'
  label        text NOT NULL,
  is_system    boolean NOT NULL DEFAULT false,  -- system roles can't be deleted
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         text UNIQUE NOT NULL,            -- e.g. 'loan.approve', 'customer.create'
  module       text NOT NULL,                   -- e.g. 'loan', 'customer'
  description  text
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ─────────────────────────── Users ─────────────────────────────────────────
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id          uuid REFERENCES branches(id) ON DELETE SET NULL,
  role_id            uuid NOT NULL REFERENCES roles(id),
  full_name          text NOT NULL,
  email              text UNIQUE,
  mobile             text UNIQUE NOT NULL,
  password_hash      text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  -- account lock
  failed_attempts    int NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role     ON users(role_id);
CREATE INDEX idx_users_branch   ON users(branch_id);
CREATE INDEX idx_users_mobile   ON users(mobile);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens (rotation + revoke). We store a hash, never the raw token.
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_hash ON refresh_tokens(token_hash);

-- ─────────────────────────── Areas ─────────────────────────────────────────
CREATE TABLE areas (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id    uuid REFERENCES branches(id) ON DELETE SET NULL,
  name         text NOT NULL,
  code         text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);
CREATE TRIGGER trg_areas_updated BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An area can have one or many collection agents (M:N).
CREATE TABLE area_agents (
  area_id    uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  agent_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id, agent_id)
);
CREATE INDEX idx_area_agents_agent ON area_agents(agent_id);

-- ─────────────────────────── Customers ─────────────────────────────────────
CREATE TABLE customers (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id             uuid REFERENCES branches(id) ON DELETE SET NULL,
  area_id               uuid REFERENCES areas(id) ON DELETE SET NULL,
  full_name             text NOT NULL,
  guardian_name         text,                 -- father / husband name
  mobile                text NOT NULL,
  alt_mobile            text,
  address               text,
  photo_path            text,
  aadhaar_no            text,
  aadhaar_path          text,
  pan_no                text,
  pan_path              text,
  signature_path        text,
  -- guarantor (kept inline; can be normalized to its own table later if reused)
  guarantor_name        text,
  guarantor_mobile      text,
  guarantor_photo_path  text,
  guarantor_aadhaar_no  text,
  guarantor_aadhaar_path text,
  guarantor_pan_no      text,
  guarantor_pan_path    text,
  guarantor_signature_path text,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_area   ON customers(area_id);
CREATE INDEX idx_customers_mobile ON customers(mobile);
CREATE INDEX idx_customers_name   ON customers(full_name);
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────── Loans ─────────────────────────────────────────
CREATE TYPE loan_status AS ENUM ('pending','approved','rejected','active','closed');
CREATE TYPE disbursement_mode AS ENUM ('cash','upi','bank_transfer');

-- Yearly sequence powering JSSF-2026-0000001
CREATE TABLE loan_number_seq (
  year   int PRIMARY KEY,
  last_no int NOT NULL DEFAULT 0
);

CREATE TABLE loans (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id          uuid REFERENCES branches(id) ON DELETE SET NULL,
  loan_number        text UNIQUE NOT NULL,            -- JSSF-2026-0000001
  customer_id        uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  principal          numeric(14,2) NOT NULL CHECK (principal > 0),
  interest_rate      numeric(6,3) NOT NULL DEFAULT 0, -- flat % on principal
  interest_amount    numeric(14,2) NOT NULL DEFAULT 0,
  processing_fee_pct numeric(6,3) NOT NULL DEFAULT 0,
  processing_fee     numeric(14,2) NOT NULL DEFAULT 0,
  loan_date          date NOT NULL DEFAULT CURRENT_DATE,
  duration_days      int NOT NULL CHECK (duration_days > 0),
  emi_amount         numeric(14,2) NOT NULL DEFAULT 0,
  total_payable      numeric(14,2) NOT NULL DEFAULT 0, -- principal + interest
  status             loan_status NOT NULL DEFAULT 'pending',
  sequence_no        int NOT NULL DEFAULT 1,           -- customer's Nth loan (drives processing fee %)
  -- approval
  approved_by        uuid REFERENCES users(id),
  approved_at        timestamptz,
  rejected_reason    text,
  -- disbursement
  disbursed_mode     disbursement_mode,
  disbursed_at       timestamptz,
  disbursed_by       uuid REFERENCES users(id),
  closed_at          timestamptz,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_loans_customer ON loans(customer_id);
CREATE INDEX idx_loans_status   ON loans(status);
CREATE INDEX idx_loans_date     ON loans(loan_date);
CREATE TRIGGER trg_loans_updated BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- EMI schedule (one row per installment).
CREATE TYPE emi_status AS ENUM ('pending','paid','partial','missed','advance');
CREATE TABLE emi_schedule (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id       uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_no int NOT NULL,
  due_date      date NOT NULL,
  due_amount    numeric(14,2) NOT NULL,
  paid_amount   numeric(14,2) NOT NULL DEFAULT 0,
  penalty_amount numeric(14,2) NOT NULL DEFAULT 0,
  status        emi_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, installment_no)
);
CREATE INDEX idx_emi_loan ON emi_schedule(loan_id);
CREATE INDEX idx_emi_due  ON emi_schedule(due_date);
CREATE INDEX idx_emi_status ON emi_schedule(status);
CREATE TRIGGER trg_emi_updated BEFORE UPDATE ON emi_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────── Collections ───────────────────────────────────
CREATE TYPE payment_type AS ENUM ('full','partial','advance');
CREATE TYPE payment_mode AS ENUM ('cash','upi','bank_transfer');

CREATE TABLE collections (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  loan_id       uuid NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  emi_id        uuid REFERENCES emi_schedule(id) ON DELETE SET NULL,
  agent_id      uuid REFERENCES users(id),
  area_id       uuid REFERENCES areas(id),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  penalty       numeric(14,2) NOT NULL DEFAULT 0,
  type          payment_type NOT NULL DEFAULT 'full',
  mode          payment_mode NOT NULL DEFAULT 'cash',
  collected_at  timestamptz NOT NULL DEFAULT now(),
  note          text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_collections_loan  ON collections(loan_id);
CREATE INDEX idx_collections_agent ON collections(agent_id);
CREATE INDEX idx_collections_date  ON collections(collected_at);
CREATE INDEX idx_collections_area  ON collections(area_id);

-- Agent cash submission + shortage tracking (agent ledger).
CREATE TABLE agent_ledger (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ledger_date    date NOT NULL DEFAULT CURRENT_DATE,
  expected_amount numeric(14,2) NOT NULL DEFAULT 0,  -- what they collected
  submitted_amount numeric(14,2) NOT NULL DEFAULT 0, -- what they handed in
  short_amount   numeric(14,2) NOT NULL DEFAULT 0,   -- expected - submitted (if > 0)
  note           text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_ledger_agent ON agent_ledger(agent_id);
CREATE INDEX idx_agent_ledger_date  ON agent_ledger(ledger_date);

-- ─────────────────────────── Expenses ──────────────────────────────────────
CREATE TABLE expense_categories (
  id     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name   text UNIQUE NOT NULL
);

CREATE TABLE expenses (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  category_id   uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  mode          payment_mode NOT NULL DEFAULT 'cash',
  expense_date  date NOT NULL DEFAULT CURRENT_DATE,
  description   text,
  bill_path     text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_date     ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category_id);

-- ─────────────────────────── Salary ────────────────────────────────────────
CREATE TABLE salaries (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_year       int NOT NULL,
  period_month      int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  base_salary       numeric(14,2) NOT NULL DEFAULT 0,
  cash_short_deduct numeric(14,2) NOT NULL DEFAULT 0,
  advance_deduct    numeric(14,2) NOT NULL DEFAULT 0,
  expense_deduct    numeric(14,2) NOT NULL DEFAULT 0,
  final_salary      numeric(14,2) NOT NULL DEFAULT 0,
  paid_at           timestamptz,
  note              text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_year, period_month)
);
CREATE TRIGGER trg_salaries_updated BEFORE UPDATE ON salaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────── Settings (configurable business rules) ────────
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── Audit log ─────────────────────────────────────
CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,        -- CREATE | UPDATE | LOGIN | APPROVAL | STATUS_CHANGE ...
  entity       text NOT NULL,        -- 'loan', 'customer', 'user' ...
  entity_id    text,
  meta         jsonb,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor  ON audit_logs(actor_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_date   ON audit_logs(created_at);

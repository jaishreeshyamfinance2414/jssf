-- Fixed monthly salary settings and user-linked personal expenses.
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);

INSERT INTO expense_categories(name)
VALUES ('User Expense')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE member_salaries (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_salary  numeric(14,2) NOT NULL CHECK (monthly_salary > 0),
  payment_day     int NOT NULL DEFAULT 1 CHECK (payment_day BETWEEN 1 AND 31),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_member_salaries_updated BEFORE UPDATE ON member_salaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Allocations make deductions auditable and allow an expense larger than one
-- month's payable salary to carry forward instead of producing a negative pay.
CREATE TABLE salary_expense_allocations (
  salary_id   uuid NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  expense_id  uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (salary_id, expense_id)
);

CREATE INDEX idx_salary_expense_allocations_expense
  ON salary_expense_allocations(expense_id);

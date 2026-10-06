-- Manual customer payment reminders created by administrators and managers.

CREATE TABLE IF NOT EXISTS reminders (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  reminder_date  date NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  note           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  completed_at   timestamptz,
  completed_by   uuid REFERENCES users(id),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_pending_date
  ON reminders(reminder_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reminders_customer ON reminders(customer_id);

DROP TRIGGER IF EXISTS trg_reminders_updated ON reminders;
CREATE TRIGGER trg_reminders_updated BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

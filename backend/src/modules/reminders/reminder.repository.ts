import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export const reminderRepository = {
  /**
   * Keep reminder creation usable even if an operator restarts new API code
   * before running the release migration. The numbered migration remains the
   * canonical schema; these idempotent statements are a startup safety net.
   */
  async ensureInfrastructure() {
    await query(`
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
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reminders_updated'
        ) THEN
          CREATE TRIGGER trg_reminders_updated BEFORE UPDATE ON reminders
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$;
    `);
  },

  async list() {
    const { rows } = await query(
      `SELECT r.id, r.customer_id, c.full_name AS customer_name, c.mobile AS customer_mobile,
              r.reminder_date, r.amount::text, r.note, r.status, r.completed_at,
              r.created_at, u.full_name AS created_by_name
         FROM reminders r
         JOIN customers c ON c.id = r.customer_id
         JOIN users u ON u.id = r.created_by
        ORDER BY (r.status = 'pending') DESC, r.reminder_date ASC, r.created_at DESC`,
    );
    return rows;
  },

  async create(input: { customerId: string; reminderDate: string; amount: number; note: string; createdBy: string }, client: PoolClient) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reminders(customer_id, reminder_date, amount, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.customerId, input.reminderDate, input.amount, input.note, input.createdBy],
    );
    return rows[0];
  },

  async complete(id: string, userId: string, client: PoolClient) {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE reminders
          SET status='completed', completed_at=now(), completed_by=$2
        WHERE id=$1 AND status='pending'
        RETURNING id`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async delete(id: string, client: PoolClient) {
    const { rows } = await client.query<{ id: string; customer_id: string; reminder_date: string; amount: string }>(
      `DELETE FROM reminders WHERE id=$1
       RETURNING id, customer_id, reminder_date, amount::text`,
      [id],
    );
    return rows[0] ?? null;
  },

  async notifications() {
    const { rows: manual } = await query(
      `SELECT r.id, 'manual'::text AS type, c.full_name AS title,
              r.note AS description, r.reminder_date AS due_date, r.amount::text,
              c.id AS customer_id, NULL::uuid AS borrowed_loan_id
         FROM reminders r
         JOIN customers c ON c.id=r.customer_id
        WHERE r.status='pending'
        ORDER BY r.reminder_date ASC, r.created_at ASC`,
    );

    const { rows: payments } = await query(
      `SELECT bl.id, 'payment'::text AS type, bl.lender_name AS title,
              CASE bl.loan_type
                WHEN 'credit_card' THEN 'Credit card payment'
                WHEN 'personal_borrowed' THEN 'Personally borrowed payment'
                ELSE 'Loan EMI payment'
              END AS description,
              CASE WHEN bl.loan_type='interest_only'
                   THEN (bl.first_payment_date + (COALESCE(p.payment_count,0)::int * interval '1 month'))::date
                   ELSE ns.due_date END AS due_date,
              CASE WHEN bl.loan_type='interest_only' THEN bl.periodic_interest ELSE ns.total_due END::text AS amount,
              NULL::uuid AS customer_id, bl.id AS borrowed_loan_id,
              bl.loan_type
         FROM borrowed_loans bl
         LEFT JOIN LATERAL (
           SELECT count(*) AS payment_count FROM borrowed_loan_payments WHERE loan_id=bl.id
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT due_date,total_due FROM borrowed_loan_schedule
            WHERE loan_id=bl.id AND paid_at IS NULL ORDER BY installment_no LIMIT 1
         ) ns ON true
        WHERE bl.status='active'
          AND (CASE WHEN bl.loan_type='interest_only'
                    THEN (bl.first_payment_date + (COALESCE(p.payment_count,0)::int * interval '1 month'))::date
                    ELSE ns.due_date END) <= CURRENT_DATE + 7
        ORDER BY due_date ASC`,
    );

    return { manual, payments, total: manual.length + payments.length };
  },
};

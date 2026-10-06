import { PoolClient } from 'pg';
import { query } from '../../db/pool';

export const reminderRepository = {
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

  async notifications() {
    const { rows: manual } = await query(
      `SELECT r.id, 'manual'::text AS type, c.full_name AS title,
              r.note AS description, r.reminder_date AS due_date, r.amount::text,
              c.id AS customer_id, NULL::uuid AS borrowed_loan_id
         FROM reminders r
         JOIN customers c ON c.id=r.customer_id
        WHERE r.status='pending' AND r.reminder_date <= CURRENT_DATE
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
                    ELSE ns.due_date END) BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        ORDER BY due_date ASC`,
    );

    return { manual, payments, total: manual.length + payments.length };
  },
};

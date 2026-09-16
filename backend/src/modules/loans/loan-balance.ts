/** Shared current-date read model. Never use cached EMI allocations or future
 * receipts to decide today's arrears. Full-term liability remains separate.
 * Caller supplies a loans alias `l`; these are fixed internal SQL fragments.
 */
export const loanBalanceJoin = `
 LEFT JOIN LATERAL (
   SELECT COALESCE(sum(c.amount + c.penalty),0) AS received
     FROM collections c WHERE c.loan_id = l.id
      AND c.collected_at < CURRENT_DATE::timestamp + interval '1 day'
 ) receipts ON true
 LEFT JOIN LATERAL (
   SELECT COALESCE(sum(p.amount),0) AS total,
          COALESCE(sum(p.amount) FILTER (WHERE p.penalty_date < CURRENT_DATE),0) AS before_today
     FROM loan_daily_penalties p WHERE p.loan_id = l.id AND p.penalty_date <= CURRENT_DATE
 ) charges ON true
 LEFT JOIN LATERAL (
   SELECT COALESCE(sum(e.due_amount) FILTER (WHERE e.due_date <= CURRENT_DATE),0) + charges.total AS expected,
          COALESCE(sum(e.due_amount) FILTER (WHERE e.due_date < CURRENT_DATE),0) + charges.before_today AS expected_before_today,
          charges.total AS penalty,
          max(e.due_date) AS closing_date
     FROM emi_schedule e WHERE e.loan_id = l.id
 ) dues ON true
 LEFT JOIN LATERAL (
   SELECT GREATEST(dues.expected - receipts.received,0) AS shortfall,
          GREATEST(receipts.received - dues.expected,0) AS advance,
          GREATEST(dues.expected_before_today - receipts.received,0) AS overdue,
          GREATEST(l.total_payable - receipts.received,0) AS remaining
 ) balance ON true
 LEFT JOIN LATERAL (
   SELECT count(*) FILTER (WHERE s.due_date < CURRENT_DATE AND s.running_due > receipts.received)::int AS missed_count,
          count(*) FILTER (WHERE s.due_date > CURRENT_DATE AND s.running_due <= receipts.received)::int AS advance_count,
          min(s.due_date) FILTER (WHERE s.running_due > receipts.received) AS next_due_date
   FROM (SELECT e.due_date, sum(e.due_amount) OVER (ORDER BY e.installment_no)
           + COALESCE((SELECT sum(p.amount) FROM loan_daily_penalties p
                        WHERE p.loan_id = e.loan_id AND p.penalty_date <= e.due_date),0) AS running_due
           FROM emi_schedule e WHERE e.loan_id = l.id) s
 ) coverage ON true`;

-- 014: Missed-EMI penalty no longer inflates the EMI's due_amount.
--
-- Penalty model change: the missed-day penalty stays recorded on
-- emi_schedule.missed_penalty and added to loans.total_payable, but it is NOT
-- added to the EMI's due_amount anymore. This keeps collections counting
-- against base EMI days only (e.g. paying 1000 on a 200/day loan always
-- covers exactly 5 days), while the penalty is still recovered through the
-- loan's total payable before it can close.
--
-- Convert existing data: strip previously-added penalty from due_amount
-- (total_payable is untouched — the penalty remains owed), then re-pour each
-- affected loan's collected total across its schedule (same fill logic as
-- collectionRepository.rebuildEmiState) so paid_amount/status stay consistent
-- with the reduced dues.

UPDATE emi_schedule
   SET due_amount = due_amount - missed_penalty
 WHERE missed_penalty > 0;

WITH affected AS (
  SELECT DISTINCT e.loan_id FROM emi_schedule e WHERE e.missed_penalty > 0
),
totals AS (
  SELECT a.loan_id, COALESCE((SELECT sum(c.amount) FROM collections c WHERE c.loan_id = a.loan_id), 0) AS collected
    FROM affected a
),
fill AS (
  SELECT e.id, e.loan_id, e.due_amount, e.due_date, e.missed_penalty,
         COALESCE(sum(e.due_amount) OVER (
           PARTITION BY e.loan_id
           ORDER BY e.installment_no
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior_due
    FROM emi_schedule e
    JOIN affected a ON a.loan_id = e.loan_id
)
UPDATE emi_schedule e
   SET paid_amount = GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)),
       status = CASE
         WHEN GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)) >= f.due_amount
              AND f.due_date > CURRENT_DATE THEN 'advance'::emi_status
         WHEN GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)) >= f.due_amount
              THEN 'paid'::emi_status
         WHEN f.due_date < CURRENT_DATE OR f.missed_penalty > 0 THEN 'missed'::emi_status
         WHEN GREATEST(0, LEAST(f.due_amount, t.collected - f.prior_due)) > 0
              THEN 'partial'::emi_status
         ELSE 'pending'::emi_status
       END
  FROM fill f
  JOIN totals t ON t.loan_id = f.loan_id
 WHERE e.id = f.id;

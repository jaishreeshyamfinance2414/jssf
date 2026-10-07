-- Give existing salary ledger entries the same member-specific sequence and
-- human-readable month description used for new salary payments.
WITH ranked_salaries AS (
  SELECT s.id,
         u.full_name,
         s.period_month,
         row_number() OVER (
           PARTITION BY s.user_id
           ORDER BY s.created_at, s.id
         ) AS salary_number
    FROM salaries s
    JOIN users u ON u.id = s.user_id
), described_salaries AS (
  SELECT id,
         salary_number::text
           || CASE
                WHEN salary_number % 100 BETWEEN 11 AND 13 THEN 'th'
                WHEN salary_number % 10 = 1 THEN 'st'
                WHEN salary_number % 10 = 2 THEN 'nd'
                WHEN salary_number % 10 = 3 THEN 'rd'
                ELSE 'th'
              END
           || ' Salary paid to ' || full_name
           || ' for ' || (ARRAY[
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
              ])[period_month]
           || ' Month' AS description
    FROM ranked_salaries
)
UPDATE account_transactions AS t
   SET description = salary.description
  FROM described_salaries AS salary
 WHERE t.source = 'salary'
   AND t.direction = 'debit'
   AND t.reference_id = salary.id;

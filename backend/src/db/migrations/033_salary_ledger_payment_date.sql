-- Keep existing cash/bank salary entries on the payment date selected by the admin.
UPDATE account_transactions AS t
   SET txn_date = s.paid_at::date
  FROM salaries AS s
 WHERE t.source = 'salary'
   AND t.direction = 'debit'
   AND t.reference_id = s.id
   AND s.paid_at IS NOT NULL
   AND t.txn_date IS DISTINCT FROM s.paid_at::date;

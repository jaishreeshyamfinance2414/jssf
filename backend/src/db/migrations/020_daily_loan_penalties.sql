-- Daily charges are independent of installment dates and continue after maturity.
CREATE TABLE IF NOT EXISTS loan_daily_penalties (
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  penalty_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (loan_id, penalty_date)
);

-- Preserve existing charges, including settled loans, without charging twice.
INSERT INTO loan_daily_penalties(loan_id, penalty_date, amount)
SELECT loan_id, due_date, sum(missed_penalty)
  FROM emi_schedule GROUP BY loan_id, due_date HAVING sum(missed_penalty) > 0
ON CONFLICT (loan_id, penalty_date) DO NOTHING;

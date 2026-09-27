-- One-time borrowed liabilities with a manually entered interest amount and due date.

ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_loan_type_check;
ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_loan_type_check1;
ALTER TABLE borrowed_loans ADD CONSTRAINT borrowed_loans_loan_type_check
  CHECK (loan_type IN ('reducing_balance','interest_only','credit_card','personal_borrowed'));

ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_check1;
ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_check;
ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_first_payment_date_check;
ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_repayment_dates_check;
ALTER TABLE borrowed_loans DROP CONSTRAINT IF EXISTS borrowed_loans_details_check;
ALTER TABLE borrowed_loans ADD CONSTRAINT borrowed_loans_repayment_dates_check
  CHECK (first_payment_date >= received_date);
ALTER TABLE borrowed_loans ADD CONSTRAINT borrowed_loans_details_check
  CHECK (
    (loan_type = 'reducing_balance' AND installment_count IS NOT NULL
      AND installment_amount IS NOT NULL AND total_payable IS NOT NULL)
    OR
    (loan_type = 'interest_only' AND periodic_interest IS NOT NULL)
    OR
    (loan_type IN ('credit_card','personal_borrowed') AND total_payable IS NOT NULL
      AND installment_count IS NULL AND installment_amount IS NULL AND periodic_interest IS NULL)
  );

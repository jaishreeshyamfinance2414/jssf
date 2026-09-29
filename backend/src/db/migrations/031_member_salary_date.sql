-- Calendar date on which the member's next salary is scheduled.
ALTER TABLE member_salaries ADD COLUMN IF NOT EXISTS salary_date date;

UPDATE member_salaries
   SET salary_date = (
     date_trunc('month', CURRENT_DATE)
     + (LEAST(payment_day, EXTRACT(day FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')))::int - 1) * interval '1 day'
   )::date
 WHERE salary_date IS NULL;

ALTER TABLE member_salaries ALTER COLUMN salary_date SET NOT NULL;

-- 016: Add work, home_type, and electricity_bill_path to customers.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS work text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS home_type text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS electricity_bill_path text;

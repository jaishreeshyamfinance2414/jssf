-- Every customer gets a unique, sequential File Number starting at 10001.
CREATE SEQUENCE customer_file_number_seq START WITH 10001;

ALTER TABLE customers ADD COLUMN file_number int UNIQUE;
ALTER TABLE customers ALTER COLUMN file_number SET DEFAULT nextval('customer_file_number_seq');

-- Backfill existing rows (oldest first) so historical customers get numbers too.
UPDATE customers SET file_number = sub.rn
  FROM (
    SELECT id, 10000 + row_number() OVER (ORDER BY created_at) AS rn
    FROM customers
  ) sub
  WHERE customers.id = sub.id AND customers.file_number IS NULL;

-- Keep the sequence ahead of any backfilled numbers.
SELECT setval('customer_file_number_seq', GREATEST(10001, (SELECT COALESCE(MAX(file_number), 10000) FROM customers) + 1), false);

ALTER TABLE customers ALTER COLUMN file_number SET NOT NULL;
CREATE INDEX idx_customers_file_number ON customers(file_number);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS latitude numeric(10,7);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS longitude numeric(10,7);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS location_accuracy numeric(12,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS location_captured_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_customers_location ON customers(latitude, longitude);

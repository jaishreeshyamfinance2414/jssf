-- Remove the processing-fee concept entirely. Loans now disburse the full
-- principal with no fee deducted or booked. Columns and the settings row are
-- dropped; may be reintroduced later as a fresh feature if needed.
ALTER TABLE loans DROP COLUMN IF EXISTS processing_fee;
ALTER TABLE loans DROP COLUMN IF EXISTS processing_fee_pct;

DELETE FROM settings WHERE key = 'processing_fee';

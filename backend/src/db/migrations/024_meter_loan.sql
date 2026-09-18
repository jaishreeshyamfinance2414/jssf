-- Meter loans use the same daily installment schedule as Daily EMI loans.
-- Keep legacy enum values for existing contracts and schedules; the API no
-- longer accepts them for new loans or edits.
ALTER TYPE emi_frequency ADD VALUE IF NOT EXISTS 'meter';
ALTER TABLE loans ALTER COLUMN emi_frequency SET DEFAULT 'daily';

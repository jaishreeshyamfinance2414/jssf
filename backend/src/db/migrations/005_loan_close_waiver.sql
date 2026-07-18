-- Manual loan closure (admin-only) with an optional waiver of the remaining
-- balance. closed_at already exists (set on auto-close when fully paid); this
-- adds who closed it and, when a waiver was used, how much and why.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS waiver_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS waiver_reason text;

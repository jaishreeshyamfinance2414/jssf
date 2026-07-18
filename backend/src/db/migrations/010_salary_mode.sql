-- Payment mode for salary payouts (cash or bank), matching expenses.
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'cash';

-- Remove the unused flat interest setting from existing installations.
DELETE FROM settings WHERE key = 'default_interest_rate';

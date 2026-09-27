-- Use one authoritative timestamp for a collection everywhere in the app.
-- Rename in place so IDs, foreign keys, audit links, and historical data remain intact.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'collections' AND column_name = 'collected_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'collections' AND column_name = 'entry_date'
  ) THEN
    ALTER TABLE collections RENAME COLUMN collected_at TO entry_date;
  END IF;
END $$;

-- The previous trigger function references the old column name. Remove its
-- trigger before touching migrated rows, then recreate it below.
DROP TRIGGER IF EXISTS trg_one_collection_per_loan_day ON collections;

-- Older backdated collection timestamps used the database clock/timezone while
-- the account transaction retained the selected business date. Restore that
-- date and preserve the collection's displayed Indian time.
UPDATE collections c
   SET entry_date = ((t.txn_date::timestamp
                      + (c.entry_date AT TIME ZONE 'Asia/Kolkata')::time)
                     AT TIME ZONE 'Asia/Kolkata')
  FROM account_transactions t
 WHERE t.source = 'collection'
   AND t.reference_id = c.id
   AND (c.entry_date AT TIME ZONE 'Asia/Kolkata')::date IS DISTINCT FROM t.txn_date;

-- Keep the date-only accounting key synchronized for collection postings. The
-- collection timestamp remains the display/report source of truth.
UPDATE account_transactions t
   SET txn_date = (c.entry_date AT TIME ZONE 'Asia/Kolkata')::date
  FROM collections c
 WHERE t.source = 'collection'
   AND t.reference_id = c.id
   AND t.txn_date IS DISTINCT FROM (c.entry_date AT TIME ZONE 'Asia/Kolkata')::date;

DROP INDEX IF EXISTS idx_collections_loan_collected_at;
CREATE INDEX IF NOT EXISTS idx_collections_loan_entry_date
  ON collections(loan_id, entry_date);

CREATE OR REPLACE FUNCTION enforce_one_collection_per_loan_day()
RETURNS trigger
SET enable_seqscan = off
AS $$
DECLARE
  entry_day date;
  is_automatic boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.loan_id = OLD.loan_id AND NEW.entry_date = OLD.entry_date THEN
    RETURN NEW;
  END IF;

  entry_day := (NEW.entry_date AT TIME ZONE 'Asia/Kolkata')::date;
  is_automatic := NEW.amount = 0 AND NEW.penalty = 0 AND NEW.created_by IS NULL
    AND NEW.note IN ('Auto-marked: no collection recorded for this day',
                     'Auto-marked: installment covered by advance payment',
                     'Auto-marked: advance coverage completed on time');

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.loan_id::text, 742019017));

  IF EXISTS (
    SELECT 1 FROM collections existing
     WHERE existing.loan_id = NEW.loan_id
       AND existing.id <> NEW.id
       AND (existing.entry_date AT TIME ZONE 'Asia/Kolkata')::date = entry_day
  ) THEN
    IF is_automatic THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'This loan already has an entry available on the selected date.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_one_collection_per_loan_day
  BEFORE INSERT OR UPDATE OF loan_id, entry_date ON collections
  FOR EACH ROW EXECUTE FUNCTION enforce_one_collection_per_loan_day();

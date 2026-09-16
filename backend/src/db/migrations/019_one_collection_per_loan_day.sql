-- Enforce the business rule that a loan can have only one statement entry on
-- a business date. A trigger is used instead of a unique index so deployment
-- does not fail when historical duplicate data already exists.

CREATE OR REPLACE FUNCTION enforce_one_collection_per_loan_day()
RETURNS trigger AS $$
DECLARE
  entry_date date;
  is_automatic boolean;
BEGIN
  -- Ordinary amount/type edits do not create a new date and must remain
  -- possible even when old data already contains duplicates.
  IF TG_OP = 'UPDATE'
     AND NEW.loan_id = OLD.loan_id
     AND NEW.collected_at = OLD.collected_at THEN
    RETURN NEW;
  END IF;

  entry_date := NEW.collected_at::date;
  is_automatic := NEW.amount = 0
    AND NEW.created_by IS NULL
    AND NEW.note IN (
      'Auto-marked: no collection recorded for this day',
      'Auto-marked: installment covered by advance payment',
      'Auto-marked: advance coverage completed on time'
    );

  -- Serialize competing inserts for this loan/date across API instances.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.loan_id::text || ':' || entry_date::text, 742019017)
  );

  IF EXISTS (
    SELECT 1
      FROM collections existing
     WHERE existing.loan_id = NEW.loan_id
       AND existing.id <> NEW.id
       AND existing.collected_at >= entry_date::timestamp
       AND existing.collected_at < entry_date::timestamp + interval '1 day'
  ) THEN
    -- A concurrent real entry wins over a derived sweep row. Returning NULL
    -- safely skips only that automatic insert without rolling back the sweep.
    IF is_automatic THEN
      RETURN NULL;
    END IF;

    RAISE EXCEPTION 'This loan already has an entry available on the selected date.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_collection_per_loan_day ON collections;
CREATE TRIGGER trg_one_collection_per_loan_day
  BEFORE INSERT OR UPDATE OF loan_id, collected_at ON collections
  FOR EACH ROW EXECUTE FUNCTION enforce_one_collection_per_loan_day();

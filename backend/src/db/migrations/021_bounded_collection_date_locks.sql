-- A long catch-up sweep must not allocate one advisory lock per calendar day.
-- Serialize by loan instead: the same duplicate-date check remains in force,
-- with one advisory lock per loan regardless of the number of missed days.
CREATE INDEX IF NOT EXISTS idx_collections_loan_collected_at ON collections(loan_id,collected_at);

CREATE OR REPLACE FUNCTION enforce_one_collection_per_loan_day()
RETURNS trigger
-- During a large first catch-up, statistics still describe the nearly empty
-- table. Keep this narrow trigger's lookup indexed instead of caching a
-- sequential scan which grows quadratically as rows are inserted.
SET enable_seqscan = off
AS $$
DECLARE
  entry_date date;
  is_automatic boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.loan_id = OLD.loan_id AND NEW.collected_at = OLD.collected_at THEN
    RETURN NEW;
  END IF;
  entry_date := NEW.collected_at::date;
  is_automatic := NEW.amount = 0 AND NEW.penalty = 0 AND NEW.created_by IS NULL
    AND NEW.note IN ('Auto-marked: no collection recorded for this day',
                    'Auto-marked: installment covered by advance payment',
                    'Auto-marked: advance coverage completed on time');
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.loan_id::text,742019017));
  IF EXISTS (SELECT 1 FROM collections existing
              WHERE existing.loan_id = NEW.loan_id AND existing.id <> NEW.id
                AND existing.collected_at >= entry_date::timestamp
                AND existing.collected_at < entry_date::timestamp + interval '1 day') THEN
    IF is_automatic THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'This loan already has an entry available on the selected date.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

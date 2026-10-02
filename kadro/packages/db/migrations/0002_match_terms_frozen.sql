-- ADR-0004: once a match has been locked for the first time (matches.locked_at set), its fee,
-- slot count and format are frozen for good, and locked_at itself can no longer change. The API
-- answers such attempts with 409 match_terms_frozen; this trigger is the database-side guard.
-- Violations raise SQLSTATE 23514 (check_violation) with constraint name matches_terms_frozen.
CREATE OR REPLACE FUNCTION matches_guard_frozen_terms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND (
    NEW.locked_at IS DISTINCT FROM OLD.locked_at
    OR NEW.fee_total_minor IS DISTINCT FROM OLD.fee_total_minor
    OR NEW.slots IS DISTINCT FROM OLD.slots
    OR NEW.format IS DISTINCT FROM OLD.format
  ) THEN
    RAISE EXCEPTION 'match terms are frozen after the first lock'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'matches_terms_frozen', TABLE = 'matches';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER matches_terms_frozen
  BEFORE UPDATE OF locked_at, fee_total_minor, slots, format ON matches
  FOR EACH ROW EXECUTE FUNCTION matches_guard_frozen_terms();

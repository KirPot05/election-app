-- Database-level integrity rules (defense in depth).
--
-- The application enforces every rule below inside its own transactions; these
-- triggers make the same rules hold even for code paths that bypass the
-- application. All error messages are prefixed with "integrity:" and carry
-- SQLSTATE P0001 (raise_exception).

-- ---------------------------------------------------------------------------
-- Election lifecycle: DRAFT -> OPEN -> CLOSED -> FINALIZED, never backwards.
-- Configuration is editable only in DRAFT. Opening requires 1 <= M < K.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION election_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'integrity: an election that has been opened cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'DRAFT' AND (
       NEW.name IS DISTINCT FROM OLD.name OR
       NEW.max_selections IS DISTINCT FROM OLD.max_selections OR
       NEW.results_visibility IS DISTINCT FROM OLD.results_visibility) THEN
    RAISE EXCEPTION 'integrity: election configuration is locked once voting has opened';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status = 'OPEN') OR
            (OLD.status = 'OPEN' AND NEW.status = 'CLOSED') OR
            (OLD.status = 'CLOSED' AND NEW.status = 'FINALIZED')) THEN
      RAISE EXCEPTION 'integrity: invalid election transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'OPEN' THEN
      SELECT count(*) INTO candidate_count FROM candidates WHERE election_id = NEW.id;
      IF NEW.max_selections < 1 OR NEW.max_selections >= candidate_count THEN
        RAISE EXCEPTION 'integrity: cannot open election: need 1 <= max selections (%) < candidates (%)',
          NEW.max_selections, candidate_count;
      END IF;
      NEW.opened_at := now();
    ELSIF NEW.status = 'CLOSED' THEN
      NEW.closed_at := now();
    ELSIF NEW.status = 'FINALIZED' THEN
      NEW.finalized_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER elections_guard
  BEFORE UPDATE OR DELETE ON elections
  FOR EACH ROW EXECUTE FUNCTION election_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Candidates may only change while the election is in DRAFT. The FOR SHARE
-- lock serializes with a concurrent DRAFT -> OPEN transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION candidate_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status election_status;
  target_election integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_election := OLD.election_id;
  ELSE
    target_election := NEW.election_id;
  END IF;

  SELECT status INTO current_status FROM elections WHERE id = target_election FOR SHARE;
  IF current_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'integrity: candidates can only be changed while the election is in DRAFT';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.election_id <> OLD.election_id THEN
    RAISE EXCEPTION 'integrity: a candidate cannot move between elections';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER candidates_guard
  BEFORE INSERT OR UPDATE OR DELETE ON candidates
  FOR EACH ROW EXECUTE FUNCTION candidate_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Voters: the registration number is immutable, and eligibility can only be
-- changed before voting opens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voter_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  open_or_later boolean;
BEGIN
  IF NEW.registration_number_normalized IS DISTINCT FROM OLD.registration_number_normalized
     OR NEW.registration_number IS DISTINCT FROM OLD.registration_number THEN
    RAISE EXCEPTION 'integrity: registration numbers cannot be changed';
  END IF;

  IF NEW.eligible IS DISTINCT FROM OLD.eligible THEN
    SELECT EXISTS (SELECT 1 FROM elections WHERE status <> 'DRAFT') INTO open_or_later;
    IF open_or_later THEN
      RAISE EXCEPTION 'integrity: eligibility can only be changed before voting opens';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER voters_guard
  BEFORE UPDATE ON voters
  FOR EACH ROW EXECUTE FUNCTION voter_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Votes are append-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_vote_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integrity: recorded votes cannot be modified or deleted (%)', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballots_append_only
  BEFORE UPDATE OR DELETE ON ballots
  FOR EACH ROW EXECUTE FUNCTION reject_vote_modification();
--> statement-breakpoint
CREATE TRIGGER ballot_choices_append_only
  BEFORE UPDATE OR DELETE ON ballot_choices
  FOR EACH ROW EXECUTE FUNCTION reject_vote_modification();
--> statement-breakpoint
CREATE TRIGGER voter_participation_append_only
  BEFORE UPDATE OR DELETE ON voter_participation
  FOR EACH ROW EXECUTE FUNCTION reject_vote_modification();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Ballots, choices and participation may only be written while the election
-- is OPEN. FOR SHARE serializes with a concurrent OPEN -> CLOSED transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION require_open_election() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status election_status;
BEGIN
  SELECT status INTO current_status FROM elections WHERE id = NEW.election_id FOR SHARE;
  IF current_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'integrity: votes can only be recorded while the election is OPEN';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballots_require_open
  BEFORE INSERT ON ballots
  FOR EACH ROW EXECUTE FUNCTION require_open_election();
--> statement-breakpoint
CREATE TRIGGER voter_participation_require_open
  BEFORE INSERT ON voter_participation
  FOR EACH ROW EXECUTE FUNCTION require_open_election();
--> statement-breakpoint

-- Choices can only be attached to a ballot created in the same transaction,
-- so a recorded ballot can never be extended later.
CREATE OR REPLACE FUNCTION ballot_choice_same_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  created_here boolean;
BEGIN
  SELECT b.xmin = pg_current_xact_id()::xid INTO created_here
    FROM ballots b WHERE b.id = NEW.ballot_id;
  IF created_here IS NOT TRUE THEN
    RAISE EXCEPTION 'integrity: choices can only be added while the ballot is being cast';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballot_choices_same_transaction
  BEFORE INSERT ON ballot_choices
  FOR EACH ROW EXECUTE FUNCTION ballot_choice_same_transaction();
--> statement-breakpoint

-- At COMMIT: every ballot holds between 1 and M choices.
CREATE OR REPLACE FUNCTION check_ballot_size() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  choice_count integer;
  max_allowed integer;
BEGIN
  SELECT (SELECT count(*) FROM ballot_choices WHERE ballot_id = NEW.id),
         (SELECT max_selections FROM elections WHERE id = NEW.election_id)
    INTO choice_count, max_allowed;
  IF choice_count < 1 OR choice_count > max_allowed THEN
    RAISE EXCEPTION 'integrity: a ballot must contain between 1 and % choices (got %)',
      max_allowed, choice_count;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ballots_size_check
  AFTER INSERT ON ballots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ballot_size();
--> statement-breakpoint

-- At COMMIT: the number of anonymous ballots equals the number of voters
-- marked as having voted. A ballot without participation (or vice versa)
-- cannot be committed.
CREATE OR REPLACE FUNCTION check_ballot_participation_parity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ballot_count integer;
  participation_count integer;
BEGIN
  -- Both counts MUST come from one statement (one snapshot). Under READ
  -- COMMITTED, two separate SELECTs could straddle another transaction's
  -- commit and report a false mismatch.
  SELECT (SELECT count(*) FROM ballots WHERE election_id = NEW.election_id),
         (SELECT count(*) FROM voter_participation WHERE election_id = NEW.election_id)
    INTO ballot_count, participation_count;
  IF ballot_count <> participation_count THEN
    RAISE EXCEPTION 'integrity: ballots (%) and participation records (%) must match',
      ballot_count, participation_count;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ballots_parity_check
  AFTER INSERT ON ballots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ballot_participation_parity();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER voter_participation_parity_check
  AFTER INSERT ON voter_participation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ballot_participation_parity();

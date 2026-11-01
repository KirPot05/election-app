import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { ballotChoices, ballots, candidates, voterParticipation, voters } from "@/server/db/schema";
import { SELECTION_ERROR_MESSAGES, validateSelection } from "@/lib/election-rules";
import { ballotSubmissionSchema, fieldErrors } from "@/lib/validation";
import { AppError, Errors, isIntegrityViolation, isUniqueViolation } from "@/server/errors";
import { lockElection } from "./election";

export type SubmitResult = {
  /** RECORDED: this request stored the ballot. ALREADY_RECORDED: an idempotent retry of an accepted submission. */
  status: "RECORDED" | "ALREADY_RECORDED";
};

const alreadyVoted = () =>
  Errors.conflict("ALREADY_VOTED", "You have already voted. Each student can submit only one ballot.");
const notOpen = (status: string) =>
  status === "DRAFT"
    ? new AppError("ELECTION_NOT_OPEN", 409, "Voting has not started yet.")
    : new AppError("ELECTION_CLOSED", 409, "Voting is closed. Your ballot was not recorded.");

/**
 * Casts a ballot in a single READ COMMITTED transaction:
 *
 *   1. SELECT election ... FOR SHARE
 *        Concurrent ballots share this lock; a close (UPDATE status) needs an
 *        exclusive row lock, so it waits for in-flight ballots to finish and
 *        ballots arriving after it wait and then see CLOSED. A ballot is
 *        therefore either committed before closure or rejected.
 *   2. SELECT voter ... FOR UPDATE
 *        Serializes all submissions of the same voter (double taps, tabs,
 *        devices, retries). The second waits, then sees the participation row.
 *   3. Participation check (idempotency): same submission key -> success
 *      without a new ballot; any other key -> ALREADY_VOTED.
 *   4. Election OPEN, voter eligible, 1..M distinct valid candidates.
 *   5. INSERT voter_participation  (PK (election_id, voter_id) is the final
 *      guarantee of one ballot per voter, independent of the locks above)
 *      INSERT ballots (random UUID, no voter reference, no timestamp)
 *      INSERT ballot_choices
 *   6. COMMIT -- deferred triggers re-check ballot size and that ballots and
 *      participation counts are equal. Any failure rolls everything back.
 *
 * Ballot contents are never logged or returned.
 */
export async function submitBallot(db: DbOrTx, voterId: string, rawInput: unknown): Promise<SubmitResult> {
  const parsed = ballotSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error), "Your ballot could not be read.");
  const { candidateIds, submissionKey } = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      const election = await lockElection(tx, "share");
      if (!election) throw notOpen("DRAFT");

      const [voter] = await tx
        .select({ id: voters.id, eligible: voters.eligible })
        .from(voters)
        .where(eq(voters.id, voterId))
        .for("update");
      if (!voter) throw Errors.unauthenticated();

      const [existing] = await tx
        .select({ submissionKey: voterParticipation.submissionKey })
        .from(voterParticipation)
        .where(and(eq(voterParticipation.electionId, election.id), eq(voterParticipation.voterId, voterId)));
      if (existing) {
        if (existing.submissionKey === submissionKey) return { status: "ALREADY_RECORDED" as const };
        throw alreadyVoted();
      }

      if (election.status !== "OPEN") throw notOpen(election.status);
      if (!voter.eligible) {
        throw new AppError("INELIGIBLE", 403, "Your account is not eligible to vote in this election.");
      }

      const valid = await tx
        .select({ id: candidates.id })
        .from(candidates)
        .where(eq(candidates.electionId, election.id));
      const selection = validateSelection(
        candidateIds,
        new Set(valid.map((c) => c.id)),
        election.maxSelections,
      );
      if (!selection.ok) {
        throw new AppError(`BALLOT_${selection.error}`, 400, SELECTION_ERROR_MESSAGES[selection.error]);
      }

      await tx.insert(voterParticipation).values({ electionId: election.id, voterId, submissionKey });
      const [ballot] = await tx.insert(ballots).values({ electionId: election.id }).returning({ id: ballots.id });
      await tx.insert(ballotChoices).values(
        selection.candidateIds.map((candidateId) => ({
          ballotId: ballot.id,
          electionId: election.id,
          candidateId,
        })),
      );
      return { status: "RECORDED" as const };
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueViolation(err, "voter_participation_election_id_voter_id_pk")) throw alreadyVoted();
    if (isIntegrityViolation(err)) {
      // e.g. the election closed between our checks and commit (should be
      // impossible given the locks, but the database is the final arbiter).
      throw new AppError("BALLOT_REJECTED", 409, "Your ballot could not be recorded. Please refresh and check your status.");
    }
    throw err;
  }
}

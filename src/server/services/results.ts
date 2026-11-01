import { asc, count, countDistinct, eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { ballotChoices, ballots, candidates, voterParticipation, voters } from "@/server/db/schema";
import {
  checkConsistency,
  computeTurnout,
  sortByVotes,
  type CandidateTotal,
  type Turnout,
} from "@/lib/results";
import type { ElectionStatus } from "@/lib/election-rules";
import { getElection } from "./election";

export type AdminDashboard = {
  election: {
    id: number;
    name: string;
    status: ElectionStatus;
    maxSelections: number;
    resultsVisibility: "LIVE" | "AFTER_CLOSE";
    candidateCount: number;
    openedAt: string | null;
    closedAt: string | null;
    finalizedAt: string | null;
  } | null;
  turnout: Turnout;
  ballots: number;
  /** null while results are hidden (results visibility AFTER_CLOSE, election not yet closed). */
  totals: CandidateTotal[] | null;
  consistency: { ok: boolean; problems: string[] };
  generatedAt: string;
};

/**
 * Aggregates only: counts and per-candidate totals. Runs in one REPEATABLE
 * READ, read-only transaction so every number comes from the same snapshot
 * (turnout and totals can't disagree mid-vote).
 */
export async function getAdminDashboard(db: Db): Promise<AdminDashboard> {
  return db.transaction(
    async (tx) => {
      const election = await getElection(tx);
      const [{ registered }] = await tx.select({ registered: count() }).from(voters);
      const [{ eligible }] = await tx
        .select({ eligible: count() })
        .from(voters)
        .where(eq(voters.eligible, true));

      if (!election) {
        return {
          election: null,
          turnout: computeTurnout({ registered, eligible, voted: 0 }),
          ballots: 0,
          totals: null,
          consistency: { ok: true, problems: [] },
          generatedAt: new Date().toISOString(),
        };
      }

      const [{ voted }] = await tx
        .select({ voted: count() })
        .from(voterParticipation)
        .where(eq(voterParticipation.electionId, election.id));
      const [{ ballotCount }] = await tx
        .select({ ballotCount: count() })
        .from(ballots)
        .where(eq(ballots.electionId, election.id));
      const [{ choiceCount }] = await tx
        .select({ choiceCount: count() })
        .from(ballotChoices)
        .where(eq(ballotChoices.electionId, election.id));

      const rows = await tx
        .select({
          candidateId: candidates.id,
          name: candidates.name,
          displayOrder: candidates.displayOrder,
          votes: countDistinct(ballotChoices.ballotId),
        })
        .from(candidates)
        .leftJoin(ballotChoices, eq(ballotChoices.candidateId, candidates.id))
        .where(eq(candidates.electionId, election.id))
        .groupBy(candidates.id)
        .orderBy(asc(candidates.displayOrder));
      const totals = sortByVotes(rows.map((r) => ({ ...r, votes: Number(r.votes) })));

      const hidden =
        election.resultsVisibility === "AFTER_CLOSE" &&
        (election.status === "DRAFT" || election.status === "OPEN");

      return {
        election: {
          id: election.id,
          name: election.name,
          status: election.status,
          maxSelections: election.maxSelections,
          resultsVisibility: election.resultsVisibility,
          candidateCount: rows.length,
          openedAt: election.openedAt?.toISOString() ?? null,
          closedAt: election.closedAt?.toISOString() ?? null,
          finalizedAt: election.finalizedAt?.toISOString() ?? null,
        },
        turnout: computeTurnout({ registered, eligible, voted }),
        ballots: ballotCount,
        totals: hidden ? null : totals,
        consistency: checkConsistency({
          ballots: ballotCount,
          participation: voted,
          choices: choiceCount,
          totals,
          maxSelections: election.maxSelections,
        }),
        generatedAt: new Date().toISOString(),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Raw tally straight from ballot_choices, used by tests to cross-check. */
export async function tallyFromDatabase(db: Db, electionId: number) {
  const rows = await db
    .select({ candidateId: ballotChoices.candidateId, votes: sql<number>`count(*)::int` })
    .from(ballotChoices)
    .where(eq(ballotChoices.electionId, electionId))
    .groupBy(ballotChoices.candidateId);
  return new Map(rows.map((r) => [r.candidateId, r.votes]));
}

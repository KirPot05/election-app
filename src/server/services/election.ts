import { count, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { candidates, elections, type Election } from "@/server/db/schema";
import {
  canTransition,
  CONFIG_ISSUE_MESSAGES,
  isConfigurationEditable,
  validateElectionConfig,
  type ElectionStatus,
} from "@/lib/election-rules";
import { electionConfigSchema, fieldErrors } from "@/lib/validation";
import { AppError, Errors, isIntegrityViolation } from "@/server/errors";
import { recordAudit } from "./audit";

/**
 * Lock ordering used everywhere in the application (prevents deadlocks):
 *   1. the election row (FOR SHARE for readers that must not race a
 *      transition, FOR UPDATE for transitions/config changes),
 *   2. then a voter row (FOR UPDATE),
 *   3. then inserts into participation/ballot tables.
 */

export async function getElection(db: DbOrTx): Promise<Election | null> {
  const [row] = await db.select().from(elections).limit(1);
  return row ?? null;
}

export async function requireElection(db: DbOrTx): Promise<Election> {
  const election = await getElection(db);
  if (!election) {
    throw new AppError("ELECTION_NOT_CONFIGURED", 409, "The election has not been set up yet.");
  }
  return election;
}

/** Locks and returns the single election row inside a transaction. */
export async function lockElection(tx: DbOrTx, mode: "share" | "update"): Promise<Election | null> {
  const [row] = await tx.select().from(elections).limit(1).for(mode);
  return row ?? null;
}

export async function candidateCount(db: DbOrTx, electionId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(candidates)
    .where(eq(candidates.electionId, electionId));
  return Number(row?.n ?? 0);
}

export async function createElection(
  db: DbOrTx,
  actor: { adminId: string | null },
  rawInput: unknown,
): Promise<Election> {
  const parsed = electionConfigSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));
  const existing = await getElection(db);
  if (existing) throw Errors.conflict("ELECTION_EXISTS", "An election already exists.");
  const [created] = await db
    .insert(elections)
    .values({
      name: parsed.data.name,
      maxSelections: parsed.data.maxSelections,
      resultsVisibility: parsed.data.resultsVisibility,
    })
    .returning();
  await recordAudit(db, {
    actorType: actor.adminId ? "admin" : "system",
    actorId: actor.adminId,
    action: "election.created",
    targetType: "election",
    targetId: created.id,
    details: { name: created.name, maxSelections: created.maxSelections },
  });
  return created;
}

export async function updateElectionConfig(
  db: DbOrTx,
  actor: { adminId: string },
  rawInput: unknown,
): Promise<Election> {
  const parsed = electionConfigSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));
  const input = parsed.data;

  return db.transaction(async (tx) => {
    const election = await lockElection(tx, "update");
    if (!election) throw Errors.notFound("Election");
    if (!isConfigurationEditable(election.status)) {
      throw Errors.conflict("CONFIG_LOCKED", "The election configuration is locked once voting has opened.");
    }
    const [updated] = await tx
      .update(elections)
      .set({
        name: input.name,
        maxSelections: input.maxSelections,
        resultsVisibility: input.resultsVisibility,
      })
      .where(eq(elections.id, election.id))
      .returning();
    await recordAudit(tx, {
      actorType: "admin",
      actorId: actor.adminId,
      action: "election.configured",
      targetType: "election",
      targetId: election.id,
      details: {
        name: input.name,
        maxSelections: input.maxSelections,
        resultsVisibility: input.resultsVisibility,
      },
    });
    return updated;
  });
}

const TRANSITION_AUDIT = {
  OPEN: "election.opened",
  CLOSED: "election.closed",
  FINALIZED: "election.finalized",
} as const;

/**
 * DRAFT -> OPEN -> CLOSED -> FINALIZED. Takes the election row FOR UPDATE,
 * which waits for every in-flight ballot/signup transaction holding FOR SHARE
 * on that row; those that start later block until this commits and then
 * observe the new status. So a ballot is either fully committed before the
 * election closes, or it is rejected.
 */
export async function transitionElection(
  db: DbOrTx,
  actor: { adminId: string },
  to: Exclude<ElectionStatus, "DRAFT">,
): Promise<Election> {
  try {
    return await db.transaction(async (tx) => {
      const election = await lockElection(tx, "update");
      if (!election) throw Errors.notFound("Election");
      if (!canTransition(election.status, to)) {
        throw Errors.conflict(
          "INVALID_TRANSITION",
          `The election cannot move from ${election.status} to ${to}.`,
        );
      }
      if (to === "OPEN") {
        const k = await candidateCount(tx, election.id);
        const issues = validateElectionConfig(election.maxSelections, k);
        if (issues.length) {
          throw Errors.conflict("INVALID_CONFIGURATION", issues.map((i) => CONFIG_ISSUE_MESSAGES[i]).join(" "));
        }
      }
      const [updated] = await tx
        .update(elections)
        .set({ status: to })
        .where(eq(elections.id, election.id))
        .returning();
      await recordAudit(tx, {
        actorType: "admin",
        actorId: actor.adminId,
        action: TRANSITION_AUDIT[to],
        targetType: "election",
        targetId: election.id,
        details: { from: election.status, to },
      });
      return updated;
    });
  } catch (err) {
    if (isIntegrityViolation(err)) {
      throw Errors.conflict("INVALID_TRANSITION", "That change is not allowed in the current election state.");
    }
    throw err;
  }
}

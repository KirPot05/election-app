import { and, asc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { voterParticipation, voters } from "@/server/db/schema";
import { isConfigurationEditable } from "@/lib/election-rules";
import { normalizeRegistrationNumber } from "@/lib/validation";
import { Errors, isIntegrityViolation } from "@/server/errors";
import { recordAudit } from "./audit";
import { getElection, lockElection } from "./election";

export type StudentFilter = "all" | "voted" | "not_voted" | "ineligible";

export type StudentRow = {
  id: string;
  fullName: string;
  registrationNumber: string;
  eligible: boolean;
  hasVoted: boolean;
  registeredAt: string;
};

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Registered students with voted / not-voted status. Exposes participation
 * only, never ballot contents (there is no join path to ballots).
 */
export async function listStudents(
  db: DbOrTx,
  opts: { q?: string; filter?: StudentFilter } = {},
): Promise<StudentRow[]> {
  const election = await getElection(db);
  const electionId = election?.id ?? -1;
  const conditions: SQL[] = [];

  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    const nameLike = `%${escapeLike(q.normalize("NFC"))}%`;
    const regLike = `%${escapeLike(normalizeRegistrationNumber(q))}%`;
    conditions.push(or(ilike(voters.fullName, nameLike), ilike(voters.registrationNumberNormalized, regLike))!);
  }
  switch (opts.filter) {
    case "voted":
      conditions.push(isNotNull(voterParticipation.voterId));
      break;
    case "not_voted":
      conditions.push(and(isNull(voterParticipation.voterId), eq(voters.eligible, true))!);
      break;
    case "ineligible":
      conditions.push(eq(voters.eligible, false));
      break;
  }

  const rows = await db
    .select({
      id: voters.id,
      fullName: voters.fullName,
      registrationNumber: voters.registrationNumber,
      eligible: voters.eligible,
      hasVoted: sql<boolean>`${voterParticipation.voterId} IS NOT NULL`,
      createdAt: voters.createdAt,
    })
    .from(voters)
    .leftJoin(
      voterParticipation,
      and(eq(voterParticipation.voterId, voters.id), eq(voterParticipation.electionId, electionId)),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(sql`lower(${voters.fullName})`), asc(voters.registrationNumberNormalized));

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    registrationNumber: r.registrationNumber,
    eligible: r.eligible,
    hasVoted: r.hasVoted,
    registeredAt: r.createdAt.toISOString(),
  }));
}

/** Revoke/restore eligibility. Only before voting opens. */
export async function setEligibility(
  db: DbOrTx,
  actor: { adminId: string },
  voterId: string,
  eligible: boolean,
): Promise<void> {
  if (typeof eligible !== "boolean") throw Errors.validation({ eligible: "Must be true or false." });
  try {
    await db.transaction(async (tx) => {
      const election = await lockElection(tx, "share");
      if (election && !isConfigurationEditable(election.status)) {
        throw Errors.conflict("ELIGIBILITY_LOCKED", "Eligibility can only be changed before voting opens.");
      }
      const [updated] = await tx
        .update(voters)
        .set({ eligible })
        .where(eq(voters.id, voterId))
        .returning({ id: voters.id });
      if (!updated) throw Errors.notFound("Student");
      await recordAudit(tx, {
        actorType: "admin",
        actorId: actor.adminId,
        action: "voter.eligibility_changed",
        targetType: "voter",
        targetId: voterId,
        details: { eligible },
      });
    });
  } catch (err) {
    if (isIntegrityViolation(err)) {
      throw Errors.conflict("ELIGIBILITY_LOCKED", "Eligibility can only be changed before voting opens.");
    }
    throw err;
  }
}

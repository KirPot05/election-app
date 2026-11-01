import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { voterParticipation, voters } from "@/server/db/schema";
import { config } from "@/server/config";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import {
  createSession,
  revokeVoterSessions,
  type VoterPrincipal,
} from "@/server/auth/session";
import { isRegistrationOpen, studentScreen, type StudentScreen } from "@/lib/election-rules";
import { changePasswordSchema, fieldErrors, loginSchema, signupSchema } from "@/lib/validation";
import { AppError, Errors, isUniqueViolation } from "@/server/errors";
import { recordAudit } from "./audit";
import { getElection, lockElection } from "./election";
import { check, consume, RATE_LIMITS, reset } from "./rate-limit";

export type RequestContext = { ip: string };

const registrationClosed = () =>
  new AppError(
    "REGISTRATION_CLOSED",
    409,
    "Registration is closed because voting has already started. Contact the election administrator if you need help.",
  );

/**
 * Self-registration. Atomic with respect to both registration-number
 * uniqueness (PostgreSQL unique constraint, not a pre-check) and election
 * state (election row locked FOR SHARE, so it cannot open mid-signup).
 */
export async function signup(db: DbOrTx, rawInput: unknown, ctx: RequestContext) {
  const parsed = signupSchema(config.registrationPattern).safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));
  const { fullName, registrationNumber, password } = parsed.data;

  const limit = await consume(db, `signup:ip:${ctx.ip}`, RATE_LIMITS.signupPerIp);
  if (!limit.allowed) throw Errors.rateLimited(limit.retryAfterSeconds);

  // Fail fast without paying for a hash when registration is clearly closed.
  const current = await getElection(db);
  if (!current || !isRegistrationOpen(current.status)) throw registrationClosed();

  const passwordHash = await hashPassword(password);

  try {
    return await db.transaction(async (tx) => {
      const election = await lockElection(tx, "share");
      if (!election || !isRegistrationOpen(election.status)) throw registrationClosed();
      const [voter] = await tx
        .insert(voters)
        .values({
          fullName,
          registrationNumber: registrationNumber.display,
          registrationNumberNormalized: registrationNumber.normalized,
          passwordHash,
        })
        .returning({ id: voters.id });
      const session = await createSession(tx, "voter", voter.id);
      return { voterId: voter.id, ...session };
    });
  } catch (err) {
    if (isUniqueViolation(err, "voters_registration_number_unique")) {
      throw Errors.conflict(
        "DUPLICATE_REGISTRATION",
        "An account with this registration number already exists. Log in instead, or ask the administrator to reset your password.",
      );
    }
    throw err;
  }
}

export async function login(db: DbOrTx, rawInput: unknown, ctx: RequestContext) {
  const parsed = loginSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));
  const { registrationNumber, password } = parsed.data;

  const ipLimit = await consume(db, `login:ip:${ctx.ip}`, RATE_LIMITS.voterLoginPerIp);
  if (!ipLimit.allowed) throw Errors.rateLimited(ipLimit.retryAfterSeconds);
  const accountKey = `login:account:${registrationNumber}`;
  const accountLimit = await check(db, accountKey, RATE_LIMITS.voterLoginPerAccount);
  if (!accountLimit.allowed) throw Errors.rateLimited(accountLimit.retryAfterSeconds);

  const [voter] = await db
    .select({ id: voters.id, passwordHash: voters.passwordHash })
    .from(voters)
    .where(eq(voters.registrationNumberNormalized, registrationNumber))
    .limit(1);

  const ok = voter ? await verifyPassword(voter.passwordHash, password) : await verifyAgainstDummy(password);
  if (!voter || !ok) {
    await consume(db, accountKey, RATE_LIMITS.voterLoginPerAccount);
    throw Errors.invalidCredentials();
  }
  await reset(db, accountKey);
  const session = await createSession(db, "voter", voter.id);
  return { voterId: voter.id, ...session };
}

/**
 * Changes the password, revokes every session of the voter (all devices) and
 * issues a fresh session for the current device. Participation is untouched.
 */
export async function changePassword(db: DbOrTx, principal: VoterPrincipal, rawInput: unknown) {
  const parsed = changePasswordSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));

  const limit = await consume(db, `password-change:${principal.voterId}`, RATE_LIMITS.passwordChangePerVoter);
  if (!limit.allowed) throw Errors.rateLimited(limit.retryAfterSeconds);

  const [voter] = await db
    .select({ passwordHash: voters.passwordHash })
    .from(voters)
    .where(eq(voters.id, principal.voterId))
    .limit(1);
  if (!voter) throw Errors.unauthenticated();
  if (!(await verifyPassword(voter.passwordHash, parsed.data.currentPassword))) {
    throw Errors.validation({ currentPassword: "Your current password is incorrect." });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);

  return db.transaction(async (tx) => {
    await tx.update(voters).set({ passwordHash }).where(eq(voters.id, principal.voterId));
    await revokeVoterSessions(tx, principal.voterId);
    const session = await createSession(tx, "voter", principal.voterId);
    await recordAudit(tx, {
      actorType: "voter",
      actorId: principal.voterId,
      action: "voter.password_changed",
      targetType: "voter",
      targetId: principal.voterId,
    });
    return session;
  });
}

export type VoterStatus = {
  election: { name: string; status: "DRAFT" | "OPEN" | "CLOSED" | "FINALIZED"; maxSelections: number } | null;
  hasVoted: boolean;
  eligible: boolean;
  screen: StudentScreen | "NOT_CONFIGURED";
};

/** Current election state as seen by one voter. Never includes vote totals. */
export async function getVoterStatus(db: DbOrTx, voterId: string): Promise<VoterStatus> {
  const election = await getElection(db);
  const [voter] = await db
    .select({ eligible: voters.eligible })
    .from(voters)
    .where(eq(voters.id, voterId))
    .limit(1);
  if (!voter) throw Errors.unauthenticated();
  if (!election) {
    return { election: null, hasVoted: false, eligible: voter.eligible, screen: "NOT_CONFIGURED" };
  }
  const [participation] = await db
    .select({ voterId: voterParticipation.voterId })
    .from(voterParticipation)
    .where(and(eq(voterParticipation.electionId, election.id), eq(voterParticipation.voterId, voterId)))
    .limit(1);
  const hasVoted = !!participation;
  return {
    election: { name: election.name, status: election.status, maxSelections: election.maxSelections },
    hasVoted,
    eligible: voter.eligible,
    screen: studentScreen({ status: election.status, eligible: voter.eligible, hasVoted }),
  };
}

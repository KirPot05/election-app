import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { recoveryTokens, voters } from "@/server/db/schema";
import { config } from "@/server/config";
import { hashPassword } from "@/server/auth/password";
import { revokeVoterSessions } from "@/server/auth/session";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { fieldErrors, recoverySchema } from "@/lib/validation";
import { AppError, Errors } from "@/server/errors";
import { recordAudit } from "./audit";
import { consume, RATE_LIMITS } from "./rate-limit";

/**
 * Admin-assisted password recovery.
 *
 * Policy (documented in README):
 *  - Issuing a token revokes the student's existing sessions on every device
 *    and invalidates any earlier unused token.
 *  - Redeeming the token sets the new password, marks the token used, and
 *    revokes all sessions again; the student then logs in normally.
 *  - Nothing here touches participation, ballots or registration numbers.
 *
 * Only SHA-256(token) is stored. The raw token is returned to the admin once
 * and is intended to be delivered in the URL fragment (#...), which browsers
 * never send to servers, so it doesn't appear in request logs.
 */
export async function issueRecoveryToken(
  db: DbOrTx,
  actor: { adminId: string },
  voterId: string,
  now: Date = new Date(),
) {
  const perAdmin = await consume(db, `recovery-issue:admin:${actor.adminId}`, RATE_LIMITS.recoveryIssuePerAdmin);
  if (!perAdmin.allowed) throw Errors.rateLimited(perAdmin.retryAfterSeconds);
  const perVoter = await consume(db, `recovery-issue:voter:${voterId}`, RATE_LIMITS.recoveryIssuePerVoter);
  if (!perVoter.allowed) throw Errors.rateLimited(perVoter.retryAfterSeconds);

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + config.recoveryTokenMinutes * 60_000);

  return db.transaction(async (tx) => {
    const [voter] = await tx
      .select({ id: voters.id, fullName: voters.fullName, registrationNumber: voters.registrationNumber })
      .from(voters)
      .where(eq(voters.id, voterId))
      .for("update");
    if (!voter) throw Errors.notFound("Student");

    await tx
      .update(recoveryTokens)
      .set({ revokedAt: now })
      .where(and(eq(recoveryTokens.voterId, voterId), isNull(recoveryTokens.usedAt), isNull(recoveryTokens.revokedAt)));
    await tx.insert(recoveryTokens).values({
      voterId,
      tokenHash: hashToken(token),
      createdByAdminId: actor.adminId,
      createdAt: now,
      expiresAt,
    });
    await revokeVoterSessions(tx, voterId);
    await recordAudit(tx, {
      actorType: "admin",
      actorId: actor.adminId,
      action: "recovery.issued",
      targetType: "voter",
      targetId: voterId,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return { token, expiresAt, voter: { fullName: voter.fullName, registrationNumber: voter.registrationNumber } };
  });
}

const invalidLink = () =>
  new AppError(
    "RECOVERY_INVALID",
    400,
    "This recovery link is invalid, expired or already used. Ask the election administrator for a new one.",
  );

export async function redeemRecoveryToken(
  db: DbOrTx,
  rawInput: unknown,
  ctx: { ip: string },
  now: Date = new Date(),
) {
  const limit = await consume(db, `recovery-redeem:ip:${ctx.ip}`, RATE_LIMITS.recoveryRedeemPerIp);
  if (!limit.allowed) throw Errors.rateLimited(limit.retryAfterSeconds);

  const parsed = recoverySchema.safeParse(rawInput);
  if (!parsed.success) {
    const fields = fieldErrors(parsed.error);
    if (fields.token) throw invalidLink();
    throw Errors.validation(fields);
  }
  const tokenHash = hashToken(parsed.data.token);

  const isUsable = (t: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date } | undefined) =>
    !!t && !t.usedAt && !t.revokedAt && t.expiresAt.getTime() > now.getTime();

  // Cheap pre-check so invalid links don't cost a password hash.
  const [pre] = await db.select().from(recoveryTokens).where(eq(recoveryTokens.tokenHash, tokenHash)).limit(1);
  if (!isUsable(pre)) throw invalidLink();

  const passwordHash = await hashPassword(parsed.data.newPassword);

  return db.transaction(async (tx) => {
    // Re-check under a row lock: two concurrent redemptions cannot both pass.
    const [token] = await tx
      .select()
      .from(recoveryTokens)
      .where(eq(recoveryTokens.tokenHash, tokenHash))
      .for("update");
    if (!token || !isUsable(token)) throw invalidLink();

    await tx.update(recoveryTokens).set({ usedAt: now }).where(eq(recoveryTokens.id, token.id));
    const [voter] = await tx
      .update(voters)
      .set({ passwordHash })
      .where(eq(voters.id, token.voterId))
      .returning({ registrationNumber: voters.registrationNumber });
    await revokeVoterSessions(tx, token.voterId);
    await recordAudit(tx, {
      actorType: "voter",
      actorId: token.voterId,
      action: "recovery.completed",
      targetType: "voter",
      targetId: token.voterId,
    });
    return { registrationNumber: voter.registrationNumber };
  });
}

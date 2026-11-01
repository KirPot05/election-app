import { and, eq, lt, ne } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { adminUsers, sessions, voters } from "@/server/db/schema";
import { config } from "@/server/config";
import { generateToken, hashToken } from "./tokens";

/**
 * Server-side sessions stored in PostgreSQL.
 *
 * The browser holds a random 256-bit token in an HttpOnly cookie; the database
 * stores only SHA-256(token) as the session id. Validation is a primary-key
 * lookup plus an expiry check, so logout and forced invalidation take effect
 * immediately on every device.
 */
export type SessionKind = "voter" | "admin";

export type VoterPrincipal = {
  sessionId: string;
  voterId: string;
  fullName: string;
  registrationNumber: string;
  eligible: boolean;
};

export type AdminPrincipal = {
  sessionId: string;
  adminId: string;
  username: string;
};

export function sessionTtlMs(kind: SessionKind): number {
  const hours = kind === "voter" ? config.voterSessionHours : config.adminSessionHours;
  return hours * 60 * 60 * 1000;
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Tokens are 43 base64url chars; reject anything implausible before hashing. */
function plausibleToken(token: string | undefined): token is string {
  return !!token && token.length >= 20 && token.length <= 100;
}

export async function createSession(
  db: DbOrTx,
  kind: SessionKind,
  subjectId: string,
  now: Date = new Date(),
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateToken();
  const sessionId = hashToken(token);
  const expiresAt = new Date(now.getTime() + sessionTtlMs(kind));
  await db.insert(sessions).values({
    id: sessionId,
    voterId: kind === "voter" ? subjectId : null,
    adminId: kind === "admin" ? subjectId : null,
    createdAt: now,
    expiresAt,
  });
  return { token, sessionId, expiresAt };
}

export async function validateVoterSession(
  db: DbOrTx,
  token: string | undefined,
  now: Date = new Date(),
): Promise<VoterPrincipal | null> {
  if (!plausibleToken(token)) return null;
  const sessionId = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      voterId: voters.id,
      fullName: voters.fullName,
      registrationNumber: voters.registrationNumber,
      eligible: voters.eligible,
    })
    .from(sessions)
    .innerJoin(voters, eq(sessions.voterId, voters.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  if (isSessionExpired(row.expiresAt, now)) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  return {
    sessionId,
    voterId: row.voterId,
    fullName: row.fullName,
    registrationNumber: row.registrationNumber,
    eligible: row.eligible,
  };
}

export async function validateAdminSession(
  db: DbOrTx,
  token: string | undefined,
  now: Date = new Date(),
): Promise<AdminPrincipal | null> {
  if (!plausibleToken(token)) return null;
  const sessionId = hashToken(token);
  const [row] = await db
    .select({ expiresAt: sessions.expiresAt, adminId: adminUsers.id, username: adminUsers.username })
    .from(sessions)
    .innerJoin(adminUsers, eq(sessions.adminId, adminUsers.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  if (isSessionExpired(row.expiresAt, now)) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  return { sessionId, adminId: row.adminId, username: row.username };
}

export async function revokeSessionByToken(db: DbOrTx, token: string | undefined): Promise<void> {
  if (!plausibleToken(token)) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Deletes every session of a voter, optionally keeping one (the current). */
export async function revokeVoterSessions(
  db: DbOrTx,
  voterId: string,
  exceptSessionId?: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(
      exceptSessionId
        ? and(eq(sessions.voterId, voterId), ne(sessions.id, exceptSessionId))
        : eq(sessions.voterId, voterId),
    );
}

export async function purgeExpiredSessions(db: DbOrTx, now: Date = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}

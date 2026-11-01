import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recoveryTokens, voters } from "@/server/db/schema";
import { hashToken } from "@/server/auth/tokens";
import { validateVoterSession } from "@/server/auth/session";
import { submitBallot } from "@/server/services/ballot";
import { issueRecoveryToken, redeemRecoveryToken } from "@/server/services/recovery";
import { getAdminDashboard } from "@/server/services/results";
import { getVoterStatus, login } from "@/server/services/voters";
import { countRows, db, expectCode, freshElection, key, openElection, registerStudent } from "./helpers";

const ip = { ip: "10.3.3.3" };
const newPw = (token: string, pw = "recovered-password") => ({ token, newPassword: pw, confirmPassword: pw });

describe("admin-assisted password recovery", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;

  beforeEach(async () => {
    ctx = await freshElection();
  });

  it("issues a single-use token, stores only its hash, and lets the student set a new password", async () => {
    const s = await registerStudent(0);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await db().select().from(recoveryTokens).where(eq(recoveryTokens.voterId, s.voterId));
    expect(row.tokenHash).toBe(hashToken(issued.token));
    expect(JSON.stringify(row)).not.toContain(issued.token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(15 * 60 * 1000);

    const before = (await db().select().from(voters).where(eq(voters.id, s.voterId)))[0];
    const result = await redeemRecoveryToken(db(), newPw(issued.token), ip);
    expect(result.registrationNumber).toBe(s.registrationNumber);
    const after = (await db().select().from(voters).where(eq(voters.id, s.voterId)))[0];
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.registrationNumberNormalized).toBe(before.registrationNumberNormalized);

    await expectCode(login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip), "INVALID_CREDENTIALS");
    expect((await login(db(), { registrationNumber: s.registrationNumber, password: "recovered-password" }, ip)).voterId).toBe(s.voterId);
  });

  it("tokens are single-use", async () => {
    const s = await registerStudent(0);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    await redeemRecoveryToken(db(), newPw(issued.token), ip);
    await expectCode(redeemRecoveryToken(db(), newPw(issued.token, "another-password"), ip), "RECOVERY_INVALID");
    expect((await login(db(), { registrationNumber: s.registrationNumber, password: "recovered-password" }, ip)).voterId).toBe(s.voterId);
  });

  it("concurrent redemptions of one token: only one succeeds", async () => {
    const s = await registerStudent(0);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    const results = await Promise.allSettled([
      redeemRecoveryToken(db(), newPw(issued.token, "password-aaaa"), ip),
      redeemRecoveryToken(db(), newPw(issued.token, "password-bbbb"), ip),
      redeemRecoveryToken(db(), newPw(issued.token, "password-cccc"), ip),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("tokens expire after 15 minutes", async () => {
    const s = await registerStudent(0);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId, new Date(Date.now() - 16 * 60 * 1000));
    await expectCode(redeemRecoveryToken(db(), newPw(issued.token), ip), "RECOVERY_INVALID");
    expect((await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip)).voterId).toBe(s.voterId);
  });

  it("issuing a new token invalidates older unused tokens", async () => {
    const s = await registerStudent(0);
    const first = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    const second = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    await expectCode(redeemRecoveryToken(db(), newPw(first.token), ip), "RECOVERY_INVALID");
    await redeemRecoveryToken(db(), newPw(second.token), ip);
  });

  it("rejects unknown and malformed tokens", async () => {
    await expectCode(redeemRecoveryToken(db(), newPw("x".repeat(43)), ip), "RECOVERY_INVALID");
    await expectCode(redeemRecoveryToken(db(), newPw("short"), ip), "RECOVERY_INVALID");
  });

  it("validates the new password", async () => {
    const s = await registerStudent(0);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    await expectCode(redeemRecoveryToken(db(), { token: issued.token, newPassword: "short", confirmPassword: "short" }, ip), "VALIDATION");
    await expectCode(redeemRecoveryToken(db(), { token: issued.token, newPassword: "long-enough-1", confirmPassword: "long-enough-2" }, ip), "VALIDATION");
    // The token is still usable after a validation failure.
    await redeemRecoveryToken(db(), newPw(issued.token), ip);
  });

  it("invalidates the student's sessions when recovery is issued and when it completes", async () => {
    const s = await registerStudent(0);
    const device = await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    expect(await validateVoterSession(db(), s.token)).toBeNull();
    expect(await validateVoterSession(db(), device.token)).toBeNull();

    // A session started between issue and redemption (old password still valid) is also revoked.
    const between = await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip);
    await redeemRecoveryToken(db(), newPw(issued.token), ip);
    expect(await validateVoterSession(db(), between.token)).toBeNull();
  });

  it("audits issuance and completion without storing the token", async () => {
    const s = await registerStudent(0);
    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    await redeemRecoveryToken(db(), newPw(issued.token), ip);
    const audit = await db().execute<{ action: string; row: string }>(
      sql`SELECT action, row_to_json(a)::text AS row FROM audit_events a WHERE action LIKE 'recovery.%' ORDER BY id`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["recovery.issued", "recovery.completed"]);
    for (const r of audit.rows) expect(r.row).not.toContain(issued.token);
  });

  it("preserves voted status, ballots and totals; the student cannot vote again", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), s.voterId, { candidateIds: ctx.candidateIds.slice(0, 2), submissionKey: key() });
    const before = { rows: await countRows(), dash: await getAdminDashboard(db()) };

    const issued = await issueRecoveryToken(db(), ctx.admin, s.voterId);
    await redeemRecoveryToken(db(), newPw(issued.token), ip);
    const relogin = await login(db(), { registrationNumber: s.registrationNumber, password: "recovered-password" }, ip);

    expect((await getVoterStatus(db(), relogin.voterId)).screen).toBe("VOTED");
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[5]], submissionKey: key() }), "ALREADY_VOTED");
    expect(await countRows()).toEqual(before.rows);
    const after = await getAdminDashboard(db());
    expect(after.totals).toEqual(before.dash.totals);
    expect(after.turnout).toEqual(before.dash.turnout);
  });

  it("rate-limits token issuance per student", async () => {
    const s = await registerStudent(0);
    for (let i = 0; i < 5; i++) await issueRecoveryToken(db(), ctx.admin, s.voterId);
    await expectCode(issueRecoveryToken(db(), ctx.admin, s.voterId), "RATE_LIMITED");
  });
});

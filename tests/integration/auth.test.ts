import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, voters } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { hashToken } from "@/server/auth/tokens";
import {
  createSession,
  revokeSessionByToken,
  validateAdminSession,
  validateVoterSession,
} from "@/server/auth/session";
import { adminLogin } from "@/server/services/admin";
import { changePassword, getVoterStatus, login, signup } from "@/server/services/voters";
import { db, expectCode, freshElection, openElection, registerStudent } from "./helpers";

const ip = { ip: "10.1.1.1" };

describe("student registration", () => {
  beforeEach(async () => {
    await freshElection();
  });

  it("registers a student, stores a normalized registration number and creates a session", async () => {
    const result = await signup(db(), { fullName: "  Zoë   D’Souza ", registrationNumber: " 21cs 0042 ", password: "correct horse" }, ip);
    const [row] = await db().select().from(voters).where(eq(voters.id, result.voterId));
    expect(row.fullName).toBe("Zoë D’Souza");
    expect(row.registrationNumber).toBe("21cs 0042");
    expect(row.registrationNumberNormalized).toBe("21CS0042");
    expect(row.eligible).toBe(true);
    const principal = await validateVoterSession(db(), result.token);
    expect(principal?.voterId).toBe(result.voterId);
    const status = await getVoterStatus(db(), result.voterId);
    expect(status.screen).toBe("WAITING");
  });

  it("preserves leading zeros", async () => {
    const r = await signup(db(), { fullName: "Lead Zero", registrationNumber: "000123", password: "password-1" }, ip);
    const [row] = await db().select().from(voters).where(eq(voters.id, r.voterId));
    expect(row.registrationNumberNormalized).toBe("000123");
  });

  it("stores passwords only as Argon2id hashes", async () => {
    const r = await signup(db(), { fullName: "Hash Check", registrationNumber: "HASH001", password: "my secret pass" }, ip);
    const [row] = await db().select().from(voters).where(eq(voters.id, r.voterId));
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row.passwordHash).not.toContain("my secret pass");
    expect(await verifyPassword(row.passwordHash, "my secret pass")).toBe(true);
    // The session table stores only a hash of the token.
    const [s] = await db().select().from(sessions).where(eq(sessions.voterId, r.voterId));
    expect(s.id).toBe(hashToken(r.token));
    expect(s.id).not.toBe(r.token);
  });

  it("rejects duplicate registration numbers, including case/space variants", async () => {
    await signup(db(), { fullName: "First Person", registrationNumber: "21CS001", password: "password-1" }, ip);
    await expectCode(signup(db(), { fullName: "Second Person", registrationNumber: "21cs 001", password: "password-2" }, ip), "DUPLICATE_REGISTRATION");
    const rows = await db().select().from(voters);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("First Person");
  });

  it("validates inputs server-side", async () => {
    const err = (await expectCode(signup(db(), { fullName: "   ", registrationNumber: "", password: "short" }, ip), "VALIDATION")) as {
      fields: Record<string, string>;
    };
    expect(Object.keys(err.fields).sort()).toEqual(["fullName", "password", "registrationNumber"]);
    expect((await db().select().from(voters)).length).toBe(0);
  });

  it("rejects signup once voting has opened", async () => {
    const { admin } = await freshElection();
    await openElection(admin.adminId);
    await expectCode(signup(db(), { fullName: "Too Late", registrationNumber: "LATE01", password: "password-1" }, ip), "REGISTRATION_CLOSED");
    expect((await db().select().from(voters)).length).toBe(0);
  });

  it("rate-limits signups per IP", async () => {
    process.env.SIGNUP_LIMIT_PER_IP = "3";
    try {
      for (let i = 0; i < 3; i++) {
        await signup(db(), { fullName: "Rate Limited", registrationNumber: `RL00${i}`, password: "password-1" }, { ip: "10.2.2.2" });
      }
      await expectCode(signup(db(), { fullName: "Rate Limited", registrationNumber: "RL009", password: "password-1" }, { ip: "10.2.2.2" }), "RATE_LIMITED");
    } finally {
      delete process.env.SIGNUP_LIMIT_PER_IP;
    }
  });
});

describe("student login and sessions", () => {
  beforeEach(async () => {
    await freshElection();
  });

  it("logs in with registration number (any case/spacing) and password", async () => {
    const s = await registerStudent(0);
    const r = await login(db(), { registrationNumber: s.registrationNumber.toLowerCase(), password: s.password }, ip);
    expect(r.voterId).toBe(s.voterId);
    expect((await validateVoterSession(db(), r.token))?.voterId).toBe(s.voterId);
  });

  it("rejects an incorrect password with a generic error", async () => {
    const s = await registerStudent(0);
    const err = (await expectCode(login(db(), { registrationNumber: s.registrationNumber, password: "wrong-password" }, ip), "INVALID_CREDENTIALS")) as Error;
    const unknown = (await expectCode(login(db(), { registrationNumber: "NOSUCH999", password: "wrong-password" }, ip), "INVALID_CREDENTIALS")) as Error;
    expect(err.message).toBe(unknown.message);
  });

  it("locks an account after repeated failures", async () => {
    const s = await registerStudent(0);
    for (let i = 0; i < 10; i++) {
      await expectCode(login(db(), { registrationNumber: s.registrationNumber, password: "nope-nope" }, ip), "INVALID_CREDENTIALS");
    }
    await expectCode(login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip), "RATE_LIMITED");
  });

  it("supports multiple concurrent sessions (devices) that persist until expiry", async () => {
    const s = await registerStudent(0);
    const a = await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip);
    const b = await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip);
    // Validating repeatedly (page refreshes) keeps working.
    for (let i = 0; i < 3; i++) {
      expect(await validateVoterSession(db(), a.token)).not.toBeNull();
      expect(await validateVoterSession(db(), b.token)).not.toBeNull();
    }
  });

  it("logout invalidates the server-side session only", async () => {
    const s = await registerStudent(0);
    const a = await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip);
    await revokeSessionByToken(db(), a.token);
    expect(await validateVoterSession(db(), a.token)).toBeNull();
    expect(await db().select().from(sessions).where(eq(sessions.id, hashToken(a.token)))).toHaveLength(0);
    expect(await validateVoterSession(db(), s.token)).not.toBeNull();
  });

  it("expires sessions and deletes them on access", async () => {
    const s = await registerStudent(0);
    const past = new Date(Date.now() - 8 * 24 * 3600 * 1000); // 8 days ago; voter TTL is 7 days
    const old = await createSession(db(), "voter", s.voterId, past);
    expect(await validateVoterSession(db(), old.token)).toBeNull();
    expect(await db().select().from(sessions).where(eq(sessions.id, old.sessionId))).toHaveLength(0);
  });

  it("does not accept a voter token as an admin session", async () => {
    const s = await registerStudent(0);
    expect(await validateAdminSession(db(), s.token)).toBeNull();
  });
});

describe("student password change", () => {
  beforeEach(async () => {
    await freshElection();
  });

  it("changes the password, revokes other sessions and rotates the current one", async () => {
    const s = await registerStudent(0);
    const other = await login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip);
    const principal = (await validateVoterSession(db(), s.token))!;
    const rotated = await changePassword(db(), principal, {
      currentPassword: s.password,
      newPassword: "brand-new-password",
      confirmPassword: "brand-new-password",
    });
    expect(await validateVoterSession(db(), s.token)).toBeNull();
    expect(await validateVoterSession(db(), other.token)).toBeNull();
    expect((await validateVoterSession(db(), rotated.token))?.voterId).toBe(s.voterId);
    await expectCode(login(db(), { registrationNumber: s.registrationNumber, password: s.password }, ip), "INVALID_CREDENTIALS");
    expect((await login(db(), { registrationNumber: s.registrationNumber, password: "brand-new-password" }, ip)).voterId).toBe(s.voterId);
  });

  it("requires the correct current password and matching confirmation", async () => {
    const s = await registerStudent(0);
    const principal = (await validateVoterSession(db(), s.token))!;
    const wrong = (await expectCode(
      changePassword(db(), principal, { currentPassword: "not-it-at-all", newPassword: "brand-new-password", confirmPassword: "brand-new-password" }),
      "VALIDATION",
    )) as { fields: Record<string, string> };
    expect(wrong.fields.currentPassword).toBeDefined();
    const mismatch = (await expectCode(
      changePassword(db(), principal, { currentPassword: s.password, newPassword: "brand-new-password", confirmPassword: "different-one" }),
      "VALIDATION",
    )) as { fields: Record<string, string> };
    expect(mismatch.fields.confirmPassword).toBeDefined();
    expect(await validateVoterSession(db(), s.token)).not.toBeNull();
  });

  it("does not affect participation", async () => {
    const { admin, candidateIds } = await freshElection();
    const s = await registerStudent(0);
    await openElection(admin.adminId);
    const { submitBallot } = await import("@/server/services/ballot");
    await submitBallot(db(), s.voterId, { candidateIds: [candidateIds[0]], submissionKey: crypto.randomUUID() });
    const principal = (await validateVoterSession(db(), s.token))!;
    const rotated = await changePassword(db(), principal, { currentPassword: s.password, newPassword: "brand-new-password", confirmPassword: "brand-new-password" });
    const p2 = (await validateVoterSession(db(), rotated.token))!;
    expect((await getVoterStatus(db(), p2.voterId)).screen).toBe("VOTED");
    await expectCode(
      submitBallot(db(), s.voterId, { candidateIds: [candidateIds[1]], submissionKey: crypto.randomUUID() }),
      "ALREADY_VOTED",
    );
  });
});

describe("administrator authentication", () => {
  beforeEach(async () => {
    await freshElection();
  });

  it("logs in with correct credentials and audits it", async () => {
    const r = await adminLogin(db(), { username: "ADMIN", password: "test-admin-password" }, ip);
    expect((await validateAdminSession(db(), r.token))?.username).toBe("admin");
    const audit = await db().execute<{ action: string }>(sql`SELECT action FROM audit_events WHERE action = 'admin.login'`);
    expect(audit.rows).toHaveLength(1);
  });

  it("rejects wrong passwords and locks out after repeated failures", async () => {
    for (let i = 0; i < 5; i++) {
      await expectCode(adminLogin(db(), { username: "admin", password: "wrong-password" }, ip), "INVALID_CREDENTIALS");
    }
    await expectCode(adminLogin(db(), { username: "admin", password: "test-admin-password" }, ip), "RATE_LIMITED");
  });

  it("does not accept an admin token as a voter session", async () => {
    const r = await adminLogin(db(), { username: "admin", password: "test-admin-password" }, ip);
    expect(await validateVoterSession(db(), r.token)).toBeNull();
  });
});

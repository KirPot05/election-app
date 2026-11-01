import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { voters } from "@/server/db/schema";
import { submitBallot } from "@/server/services/ballot";
import { createCandidate } from "@/server/services/candidates";
import { getElection, transitionElection } from "@/server/services/election";
import { getAdminDashboard, tallyFromDatabase } from "@/server/services/results";
import { signup } from "@/server/services/voters";
import { countRows, db, freshElection, key, openElection, registerStudent } from "./helpers";

/** A separate raw connection, used to hold locks at precise moments. */
async function rawClient() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

const settledCodes = (results: PromiseSettledResult<unknown>[]) =>
  results.map((r) =>
    r.status === "fulfilled"
      ? (r.value as { status: string }).status
      : ((r.reason as { code?: string }).code ?? `ERR:${(r.reason as Error).message}`),
  );

/** Resolves true if the promise is still pending after `ms`. */
async function stillPending(p: Promise<unknown>, ms = 400) {
  const marker = Symbol();
  const winner = await Promise.race([p.then(() => "done", () => "done"), new Promise((r) => setTimeout(() => r(marker), ms))]);
  return winner === marker;
}

describe("concurrency", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;

  beforeEach(async () => {
    ctx = await freshElection();
  });

  it("concurrent signups with the same registration number: exactly one succeeds", async () => {
    const attempts = Array.from({ length: 8 }, (_, i) =>
      signup(
        db(),
        // Different spacing/case all normalize to the same registration number.
        { fullName: `Racer ${String.fromCharCode(65 + i)}`, registrationNumber: i % 2 ? "race 001" : "RACE001", password: "password-123" },
        { ip: `10.9.0.${i}` },
      ),
    );
    const results = await Promise.allSettled(attempts);
    const codes = settledCodes(results);
    expect(codes.filter((c) => c === "DUPLICATE_REGISTRATION")).toHaveLength(7);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await db().select().from(voters).where(eq(voters.registrationNumberNormalized, "RACE001"));
    expect(rows).toHaveLength(1);
  });

  it("simultaneous submissions by the same student: exactly one ballot is recorded", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const attempts = Array.from({ length: 12 }, (_, i) =>
      submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[i % 12]], submissionKey: key() }),
    );
    const codes = settledCodes(await Promise.allSettled(attempts));
    expect(codes.filter((c) => c === "RECORDED")).toHaveLength(1);
    expect(codes.filter((c) => c === "ALREADY_VOTED")).toHaveLength(11);
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 1 });
  });

  it("double-tap retries with the same submission key record one ballot", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const body = { candidateIds: ctx.candidateIds.slice(0, 5), submissionKey: key() };
    const codes = settledCodes(await Promise.allSettled(Array.from({ length: 6 }, () => submitBallot(db(), s.voterId, body))));
    expect(codes.filter((c) => c === "RECORDED")).toHaveLength(1);
    expect(codes.filter((c) => c === "ALREADY_RECORDED")).toHaveLength(5);
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 5 });
  });

  it("simultaneous submissions by different students are all recorded", async () => {
    const students = [];
    for (let i = 0; i < 20; i++) students.push(await registerStudent(i));
    await openElection(ctx.admin.adminId);
    // Student i votes for candidates i % 12 and (i + 1) % 12.
    const ballots = students.map((_, i) => [ctx.candidateIds[i % 12], ctx.candidateIds[(i + 1) % 12]]);
    const codes = settledCodes(
      await Promise.allSettled(students.map((s, i) => submitBallot(db(), s.voterId, { candidateIds: ballots[i], submissionKey: key() }))),
    );
    expect(codes).toEqual(Array(20).fill("RECORDED"));
    expect(await countRows()).toMatchObject({ participation: 20, ballots: 20, choices: 40 });

    const expected = new Map<number, number>();
    for (const b of ballots) for (const id of b) expected.set(id, (expected.get(id) ?? 0) + 1);
    expect(await tallyFromDatabase(db(), ctx.election.id)).toEqual(expected);
  });

  it("closing waits for an in-flight ballot transaction (ballot commits first)", async () => {
    await openElection(ctx.admin.adminId);
    const holder = await rawClient();
    try {
      // Simulate an in-flight ballot: hold the election row FOR SHARE.
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM elections FOR SHARE");
      const closing = transitionElection(db(), ctx.admin, "CLOSED");
      expect(await stillPending(closing)).toBe(true);
      await holder.query("COMMIT");
      expect((await closing).status).toBe("CLOSED");
    } finally {
      await holder.end();
    }
  });

  it("a ballot arriving while the election is being closed is rejected, not half-recorded", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const closer = await rawClient();
    try {
      // Simulate a close that has taken the row lock but not yet committed.
      await closer.query("BEGIN");
      await closer.query("UPDATE elections SET status = 'CLOSED'");
      const ballot = submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
      expect(await stillPending(ballot)).toBe(true);
      await closer.query("COMMIT");
      await expect(ballot).rejects.toMatchObject({ code: "ELECTION_CLOSED" });
    } finally {
      await closer.end();
    }
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0, choices: 0 });
  });

  it("stress: close racing with many submissions leaves totals consistent", async () => {
    const students = [];
    for (let i = 0; i < 30; i++) students.push(await registerStudent(i));
    await openElection(ctx.admin.adminId);

    const submissions = students.map((s, i) =>
      submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[i % 12]], submissionKey: key() }),
    );
    // Close after a few submissions have started.
    const close = new Promise((r) => setTimeout(r, 15)).then(() => transitionElection(db(), ctx.admin, "CLOSED"));
    const [results] = await Promise.all([Promise.allSettled(submissions), close]);
    const codes = settledCodes(results);
    const recorded = codes.filter((c) => c === "RECORDED").length;
    expect(codes.every((c) => c === "RECORDED" || c === "ELECTION_CLOSED")).toBe(true);

    const rows = await countRows();
    expect(rows.participation).toBe(recorded);
    expect(rows.ballots).toBe(recorded);
    expect(rows.choices).toBe(recorded);
    const dash = await getAdminDashboard(db());
    expect(dash.consistency.ok).toBe(true);
    expect(dash.turnout.voted).toBe(recorded);
    expect((await getElection(db()))?.status).toBe("CLOSED");
  });

  it("opening serializes with concurrent candidate edits (no candidate added after opening)", async () => {
    const holder = await rawClient();
    try {
      // An in-flight candidate edit holds the election row FOR SHARE ...
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM elections FOR SHARE");
      const opening = openElection(ctx.admin.adminId);
      expect(await stillPending(opening)).toBe(true);
      await holder.query("COMMIT");
      await opening;
    } finally {
      await holder.end();
    }
    // ... and an edit attempted after opening is refused.
    await expect(createCandidate(db(), ctx.admin, { name: "Late Entry" })).rejects.toMatchObject({ code: "CONFIG_LOCKED" });
    const [{ n }] = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM candidates`)).rows;
    expect(n).toBe(12);
  });

  it("signup cannot slip in after the election opens", async () => {
    const holder = await rawClient();
    try {
      await holder.query("BEGIN");
      await holder.query("UPDATE elections SET status = 'OPEN'");
      const attempt = signup(db(), { fullName: "Late Student", registrationNumber: "LATE001", password: "password-123" }, { ip: "10.8.0.1" });
      await holder.query("COMMIT");
      await expect(attempt).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    } finally {
      await holder.end();
    }
    expect((await countRows()).voters).toBe(0);
  });
});

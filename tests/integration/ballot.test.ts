import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { submitBallot } from "@/server/services/ballot";
import { transitionElection } from "@/server/services/election";
import { tallyFromDatabase } from "@/server/services/results";
import { countRows, db, expectCode, freshElection, hasVoted, key, openElection, registerStudent } from "./helpers";

describe("ballot submission", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;

  beforeEach(async () => {
    ctx = await freshElection(); // 12 candidates, M = 5
  });

  it("rejects voting before the election is activated (DRAFT)", async () => {
    const s = await registerStudent(0);
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }), "ELECTION_NOT_OPEN");
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0, choices: 0 });
  });

  it("records a valid ballot atomically and marks participation", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const chosen = ctx.candidateIds.slice(0, 3);
    const result = await submitBallot(db(), s.voterId, { candidateIds: chosen, submissionKey: key() });
    expect(result.status).toBe("RECORDED");
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 3 });
    expect(await hasVoted(s.voterId)).toBe(true);
    const tally = await tallyFromDatabase(db(), ctx.election.id);
    for (const id of chosen) expect(tally.get(id)).toBe(1);
    expect(tally.size).toBe(3);
  });

  it("accepts 1..M selections", async () => {
    const students = [];
    for (let i = 0; i < 5; i++) students.push(await registerStudent(i));
    await openElection(ctx.admin.adminId);
    for (let m = 1; m <= 5; m++) {
      const r = await submitBallot(db(), students[m - 1].voterId, { candidateIds: ctx.candidateIds.slice(0, m), submissionKey: key() });
      expect(r.status).toBe("RECORDED");
    }
    expect(await countRows()).toMatchObject({ participation: 5, ballots: 5, choices: 1 + 2 + 3 + 4 + 5 });
  });

  it("rejects more than M selections without writing anything", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: ctx.candidateIds.slice(0, 6), submissionKey: key() }), "BALLOT_TOO_MANY");
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0, choices: 0 });
    expect(await hasVoted(s.voterId)).toBe(false);
  });

  it("rejects an empty ballot", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [], submissionKey: key() }), "BALLOT_EMPTY");
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0 });
  });

  it("rejects duplicate candidate selections", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const id = ctx.candidateIds[0];
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [id, id], submissionKey: key() }), "BALLOT_DUPLICATE");
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0 });
  });

  it("rejects an invalid candidate id", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0], 999_999], submissionKey: key() }), "BALLOT_INVALID_CANDIDATE");
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0 });
  });

  it("rejects malformed payloads", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: ["1"], submissionKey: key() }), "VALIDATION");
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [1], submissionKey: "not-a-uuid" }), "VALIDATION");
    await expectCode(submitBallot(db(), s.voterId, null), "VALIDATION");
  });

  it("rejects a second ballot from the same student (different submission)", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[1]], submissionKey: key() }), "ALREADY_VOTED");
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 1 });
    const tally = await tallyFromDatabase(db(), ctx.election.id);
    expect(tally.get(ctx.candidateIds[1])).toBeUndefined();
  });

  it("treats a retry with the same submission key as idempotent success", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const submissionKey = key();
    const body = { candidateIds: ctx.candidateIds.slice(0, 2), submissionKey };
    expect((await submitBallot(db(), s.voterId, body)).status).toBe("RECORDED");
    expect((await submitBallot(db(), s.voterId, body)).status).toBe("ALREADY_RECORDED");
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 2 });
  });

  it("rejects ineligible students", async () => {
    const s = await registerStudent(0);
    await db().execute(sql`UPDATE voters SET eligible = false WHERE id = ${s.voterId}`);
    await openElection(ctx.admin.adminId);
    await expectCode(submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }), "INELIGIBLE");
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0 });
  });

  it("rejects ballots after the election is closed and after finalization", async () => {
    const a = await registerStudent(0);
    const b = await registerStudent(1);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), a.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    await transitionElection(db(), ctx.admin, "CLOSED");
    await expectCode(submitBallot(db(), b.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }), "ELECTION_CLOSED");
    await transitionElection(db(), ctx.admin, "FINALIZED");
    await expectCode(submitBallot(db(), b.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }), "ELECTION_CLOSED");
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 1 });
    expect(await hasVoted(b.voterId)).toBe(false);
  });

  it("an already-voted student still sees ALREADY_VOTED after closure", async () => {
    const a = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), a.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    await transitionElection(db(), ctx.admin, "CLOSED");
    await expectCode(submitBallot(db(), a.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }), "ALREADY_VOTED");
  });

  it("rolls back participation and ballot when a later insert fails", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    // Inject a failure into the last step (ballot_choices insert) of the transaction.
    await db().execute(sql`
      CREATE OR REPLACE FUNCTION test_fail_choice() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$`);
    await db().execute(sql`CREATE TRIGGER test_fail_choice BEFORE INSERT ON ballot_choices FOR EACH ROW EXECUTE FUNCTION test_fail_choice()`);
    try {
      await expect(
        submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }),
      ).rejects.toThrow();
    } finally {
      await db().execute(sql`DROP TRIGGER test_fail_choice ON ballot_choices`);
      await db().execute(sql`DROP FUNCTION test_fail_choice()`);
    }
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0, choices: 0 });
    expect(await hasVoted(s.voterId)).toBe(false);
    // The student can still vote afterwards.
    const ok = await submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    expect(ok.status).toBe("RECORDED");
  });

  it("stores ballots without any voter reference or timestamp", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    const cols = await db().execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('ballots', 'ballot_choices') ORDER BY 1, 2`);
    expect(cols.rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "ballot_choices.ballot_id",
      "ballot_choices.candidate_id",
      "ballot_choices.election_id",
      "ballots.election_id",
      "ballots.id",
    ]);
    const ballot = await db().execute<{ row: string }>(sql`SELECT row_to_json(b)::text AS row FROM ballots b`);
    expect(ballot.rows[0].row).not.toContain(s.voterId);
  });
});

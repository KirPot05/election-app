import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { submitBallot } from "@/server/services/ballot";
import { countRows, db, freshElection, key, openElection, registerStudent } from "./helpers";

/**
 * Exercises the database-level guards directly with raw SQL, bypassing the
 * application, to prove the rules hold even for code that skips the services.
 */
describe("database integrity constraints", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;
  let client: pg.Client;

  beforeEach(async () => {
    ctx = await freshElection();
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterEach(async () => {
    await client.end();
  });

  const q = (text: string, params: unknown[] = []) => client.query(text, params);
  const rejects = (text: string, params: unknown[] = [], pattern: RegExp = /integrity:/) =>
    expect(q(text, params)).rejects.toThrow(pattern);

  it("enforces the state machine", async () => {
    await rejects("UPDATE elections SET status = 'CLOSED'");
    await rejects("UPDATE elections SET status = 'FINALIZED'");
    await q("UPDATE elections SET status = 'OPEN'");
    await rejects("UPDATE elections SET status = 'DRAFT'");
    await q("UPDATE elections SET status = 'CLOSED'");
    await rejects("UPDATE elections SET status = 'OPEN'");
    await q("UPDATE elections SET status = 'FINALIZED'");
    await rejects("UPDATE elections SET status = 'CLOSED'");
    await rejects("DELETE FROM elections");
  });

  it("refuses to open with M >= K", async () => {
    await q("UPDATE elections SET max_selections = 12");
    await rejects("UPDATE elections SET status = 'OPEN'", [], /cannot open election/);
  });

  it("locks configuration and candidates after opening", async () => {
    await q("UPDATE elections SET status = 'OPEN'");
    await rejects("UPDATE elections SET max_selections = 2");
    await rejects("UPDATE elections SET name = 'Other'");
    await rejects("INSERT INTO candidates (election_id, name) VALUES ($1, 'Late')", [ctx.election.id]);
    await rejects("UPDATE candidates SET name = 'Renamed' WHERE id = $1", [ctx.candidateIds[0]]);
    await rejects("DELETE FROM candidates WHERE id = $1", [ctx.candidateIds[0]]);
  });

  it("rejects ballots outside OPEN", async () => {
    await rejects("INSERT INTO ballots (election_id) VALUES ($1)", [ctx.election.id]);
  });

  it("makes recorded votes append-only", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    await rejects("UPDATE ballot_choices SET candidate_id = $1", [ctx.candidateIds[1]]);
    await rejects("DELETE FROM ballot_choices");
    await rejects("DELETE FROM ballots");
    await rejects("DELETE FROM voter_participation");
    await rejects("UPDATE voter_participation SET submission_key = gen_random_uuid()");
    await expect(q("DELETE FROM voters")).rejects.toThrow(/foreign key|integrity/);
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 1 });
  });

  it("rejects a ballot without participation, and vice versa, at commit", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await q("BEGIN");
    const b = await q("INSERT INTO ballots (election_id) VALUES ($1) RETURNING id", [ctx.election.id]);
    await q("INSERT INTO ballot_choices (ballot_id, election_id, candidate_id) VALUES ($1, $2, $3)", [b.rows[0].id, ctx.election.id, ctx.candidateIds[0]]);
    await expect(q("COMMIT")).rejects.toThrow(/must match/);

    await q("BEGIN");
    await q("INSERT INTO voter_participation (election_id, voter_id, submission_key) VALUES ($1, $2, gen_random_uuid())", [ctx.election.id, s.voterId]);
    await expect(q("COMMIT")).rejects.toThrow(/must match/);
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0, choices: 0 });
  });

  it("rejects empty or oversized ballots at commit", async () => {
    const [s1, s2] = [await registerStudent(0), await registerStudent(1)];
    await openElection(ctx.admin.adminId);
    // Empty ballot.
    await q("BEGIN");
    await q("INSERT INTO voter_participation (election_id, voter_id, submission_key) VALUES ($1, $2, gen_random_uuid())", [ctx.election.id, s1.voterId]);
    await q("INSERT INTO ballots (election_id) VALUES ($1)", [ctx.election.id]);
    await expect(q("COMMIT")).rejects.toThrow(/between 1 and 5/);
    // M + 1 choices.
    await q("BEGIN");
    await q("INSERT INTO voter_participation (election_id, voter_id, submission_key) VALUES ($1, $2, gen_random_uuid())", [ctx.election.id, s2.voterId]);
    const b = await q("INSERT INTO ballots (election_id) VALUES ($1) RETURNING id", [ctx.election.id]);
    for (const c of ctx.candidateIds.slice(0, 6)) {
      await q("INSERT INTO ballot_choices (ballot_id, election_id, candidate_id) VALUES ($1, $2, $3)", [b.rows[0].id, ctx.election.id, c]);
    }
    await expect(q("COMMIT")).rejects.toThrow(/between 1 and 5/);
    expect(await countRows()).toMatchObject({ participation: 0, ballots: 0, choices: 0 });
  });

  it("prevents adding choices to an already recorded ballot", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    const { rows } = await q("SELECT id FROM ballots");
    await rejects("INSERT INTO ballot_choices (ballot_id, election_id, candidate_id) VALUES ($1, $2, $3)", [rows[0].id, ctx.election.id, ctx.candidateIds[1]]);
  });

  it("enforces unique choices and same-election candidate references", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await q("BEGIN");
    await q("INSERT INTO voter_participation (election_id, voter_id, submission_key) VALUES ($1, $2, gen_random_uuid())", [ctx.election.id, s.voterId]);
    const b = await q("INSERT INTO ballots (election_id) VALUES ($1) RETURNING id", [ctx.election.id]);
    await q("INSERT INTO ballot_choices (ballot_id, election_id, candidate_id) VALUES ($1, $2, $3)", [b.rows[0].id, ctx.election.id, ctx.candidateIds[0]]);
    await expect(
      q("INSERT INTO ballot_choices (ballot_id, election_id, candidate_id) VALUES ($1, $2, $3)", [b.rows[0].id, ctx.election.id, ctx.candidateIds[0]]),
    ).rejects.toThrow(/duplicate key/);
    await q("ROLLBACK");
  });

  it("allows only one participation row per voter", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    await submitBallot(db(), s.voterId, { candidateIds: [ctx.candidateIds[0]], submissionKey: key() });
    await expect(
      q("INSERT INTO voter_participation (election_id, voter_id, submission_key) VALUES ($1, $2, gen_random_uuid())", [ctx.election.id, s.voterId]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("keeps registration numbers immutable and locks eligibility after opening", async () => {
    const s = await registerStudent(0);
    await rejects("UPDATE voters SET registration_number_normalized = 'OTHER' WHERE id = $1", [s.voterId]);
    await q("UPDATE voters SET eligible = false WHERE id = $1", [s.voterId]);
    await q("UPDATE voters SET eligible = true WHERE id = $1", [s.voterId]);
    await openElection(ctx.admin.adminId);
    await rejects("UPDATE voters SET eligible = false WHERE id = $1", [s.voterId]);
    // Password changes remain possible (recovery).
    await q("UPDATE voters SET password_hash = 'x' WHERE id = $1", [s.voterId]);
  });
});

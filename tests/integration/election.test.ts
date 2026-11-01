import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createCandidate, deleteCandidate, importCandidates, listCandidates, updateCandidate } from "@/server/services/candidates";
import { createElection, getElection, transitionElection, updateElectionConfig } from "@/server/services/election";
import { setEligibility } from "@/server/services/students";
import { getVoterStatus } from "@/server/services/voters";
import { db, expectCode, freshElection, openElection, registerStudent, resetDb } from "./helpers";
import { seedAdmin } from "../../scripts/lib/fixtures";

describe("election configuration and lifecycle", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;

  beforeEach(async () => {
    ctx = await freshElection({ candidateCount: 0 });
  });

  it("creates the election only once", async () => {
    await resetDb();
    const admin = await seedAdmin(db(), { username: "admin", password: "test-admin-password" });
    const e = await createElection(db(), { adminId: admin.id }, { name: "Student Council", maxSelections: 3 });
    expect(e).toMatchObject({ name: "Student Council", maxSelections: 3, status: "DRAFT", resultsVisibility: "LIVE" });
    await expectCode(createElection(db(), { adminId: admin.id }, { name: "Second", maxSelections: 1 }), "ELECTION_EXISTS");
    // The singleton index enforces this in the database too.
    await expect(db().execute(sql`INSERT INTO elections (name, max_selections) VALUES ('x', 1)`)).rejects.toThrow();
  });

  it("creates, edits and deletes candidates in DRAFT", async () => {
    const a = await createCandidate(db(), ctx.admin, { name: "  Asha   Verma ", description: "CSE" });
    expect(a.name).toBe("Asha Verma");
    const b = await createCandidate(db(), ctx.admin, { name: "Bala Krishnan" });
    expect(b.displayOrder).toBe(a.displayOrder + 1);
    await updateCandidate(db(), ctx.admin, a.id, { name: "Asha V.", description: "CSE, 3rd year" });
    await deleteCandidate(db(), ctx.admin, b.id);
    const list = await listCandidates(db(), ctx.election.id);
    expect(list.map((c) => [c.name, c.description])).toEqual([["Asha V.", "CSE, 3rd year"]]);
  });

  it("rejects duplicate candidate names (case-insensitive)", async () => {
    await createCandidate(db(), ctx.admin, { name: "Asha Verma" });
    await expectCode(createCandidate(db(), ctx.admin, { name: "asha verma" }), "DUPLICATE_CANDIDATE");
  });

  it("imports candidates from CSV, validating every row before writing", async () => {
    const bad = "name,description\nAsha,ok\n,missing name\nAsha,duplicate\n";
    const err = (await expectCode(importCandidates(db(), ctx.admin, { csv: bad, replace: false }), "IMPORT_INVALID")) as Error;
    expect(err.message).toContain("Line 3");
    expect(err.message).toContain("Line 4");
    expect(await listCandidates(db(), ctx.election.id)).toHaveLength(0);

    const good = 'name,description\n"Verma, Asha","CSE, 3rd year"\nBala\n';
    expect(await importCandidates(db(), ctx.admin, { csv: good, replace: false })).toEqual({ imported: 2 });
    expect(await importCandidates(db(), ctx.admin, { csv: "name\nChitra\n", replace: true })).toEqual({ imported: 1 });
    expect((await listCandidates(db(), ctx.election.id)).map((c) => c.name)).toEqual(["Chitra"]);
  });

  it("updates configuration in DRAFT", async () => {
    const e = await updateElectionConfig(db(), ctx.admin, { name: "Renamed", maxSelections: 2, resultsVisibility: "AFTER_CLOSE" });
    expect(e).toMatchObject({ name: "Renamed", maxSelections: 2, resultsVisibility: "AFTER_CLOSE" });
  });

  it("refuses to open when M >= K or K < 2", async () => {
    await createCandidate(db(), ctx.admin, { name: "Only One" });
    await expectCode(openElection(ctx.admin.adminId), "INVALID_CONFIGURATION");
    for (const n of ["Two", "Three", "Four", "Five"]) await createCandidate(db(), ctx.admin, { name: n });
    // K = 5, M = 5 -> still invalid.
    await expectCode(openElection(ctx.admin.adminId), "INVALID_CONFIGURATION");
    await createCandidate(db(), ctx.admin, { name: "Six" });
    expect((await openElection(ctx.admin.adminId)).status).toBe("OPEN");
  });

  it("follows DRAFT -> OPEN -> CLOSED -> FINALIZED and rejects every other transition", async () => {
    await importCandidates(db(), ctx.admin, { csv: "name\nA\nB\nC\nD\nE\nF\n", replace: false });
    await expectCode(transitionElection(db(), ctx.admin, "CLOSED"), "INVALID_TRANSITION");
    await expectCode(transitionElection(db(), ctx.admin, "FINALIZED"), "INVALID_TRANSITION");
    const opened = await openElection(ctx.admin.adminId);
    expect(opened.openedAt).toBeInstanceOf(Date);
    await expectCode(transitionElection(db(), ctx.admin, "OPEN"), "INVALID_TRANSITION");
    await expectCode(transitionElection(db(), ctx.admin, "FINALIZED"), "INVALID_TRANSITION");
    const closed = await transitionElection(db(), ctx.admin, "CLOSED");
    expect(closed.closedAt).toBeInstanceOf(Date);
    await expectCode(transitionElection(db(), ctx.admin, "OPEN"), "INVALID_TRANSITION");
    const fin = await transitionElection(db(), ctx.admin, "FINALIZED");
    expect(fin.finalizedAt).toBeInstanceOf(Date);
    for (const to of ["OPEN", "CLOSED", "FINALIZED"] as const) {
      await expectCode(transitionElection(db(), ctx.admin, to), "INVALID_TRANSITION");
    }
    const audit = await db().execute<{ action: string }>(sql`SELECT action FROM audit_events WHERE action LIKE 'election.%' ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(["election.opened", "election.closed", "election.finalized"]);
  });

  it("locks configuration, candidates and eligibility once voting has opened", async () => {
    await importCandidates(db(), ctx.admin, { csv: "name\nA\nB\nC\nD\nE\nF\n", replace: false });
    const s = await registerStudent(0);
    const [cand] = await listCandidates(db(), ctx.election.id);
    await openElection(ctx.admin.adminId);

    for (const status of ["OPEN", "CLOSED", "FINALIZED"] as const) {
      if (status !== "OPEN") await transitionElection(db(), ctx.admin, status);
      await expectCode(updateElectionConfig(db(), ctx.admin, { name: "X", maxSelections: 1 }), "CONFIG_LOCKED");
      await expectCode(createCandidate(db(), ctx.admin, { name: "Late" }), "CONFIG_LOCKED");
      await expectCode(updateCandidate(db(), ctx.admin, cand.id, { name: "Renamed" }), "CONFIG_LOCKED");
      await expectCode(deleteCandidate(db(), ctx.admin, cand.id), "CONFIG_LOCKED");
      await expectCode(importCandidates(db(), ctx.admin, { csv: "name\nZ\n", replace: true }), "CONFIG_LOCKED");
      await expectCode(setEligibility(db(), ctx.admin, s.voterId, false), "ELIGIBILITY_LOCKED");
    }
    const e = await getElection(db());
    expect(e).toMatchObject({ name: "College Election 2026", maxSelections: 5, status: "FINALIZED" });
    expect(await listCandidates(db(), ctx.election.id)).toHaveLength(6);
  });

  it("student screens follow the election state", async () => {
    await importCandidates(db(), ctx.admin, { csv: "name\nA\nB\nC\nD\nE\nF\n", replace: false });
    const s = await registerStudent(0);
    const blocked = await registerStudent(1);
    await setEligibility(db(), ctx.admin, blocked.voterId, false);
    expect((await getVoterStatus(db(), s.voterId)).screen).toBe("WAITING");
    expect((await getVoterStatus(db(), blocked.voterId)).screen).toBe("INELIGIBLE");
    await openElection(ctx.admin.adminId);
    expect((await getVoterStatus(db(), s.voterId)).screen).toBe("BALLOT");
    expect((await getVoterStatus(db(), blocked.voterId)).screen).toBe("INELIGIBLE");
    await transitionElection(db(), ctx.admin, "CLOSED");
    expect((await getVoterStatus(db(), s.voterId)).screen).toBe("CLOSED");
    await transitionElection(db(), ctx.admin, "FINALIZED");
    expect((await getVoterStatus(db(), s.voterId)).screen).toBe("FINALIZED");
  });
});

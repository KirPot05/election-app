import { beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { submitBallot } from "@/server/services/ballot";
import { transitionElection, updateElectionConfig } from "@/server/services/election";
import { auditCsv, participationCsv, resultsCsv } from "@/server/services/export";
import { getAdminDashboard, tallyFromDatabase } from "@/server/services/results";
import { setEligibility } from "@/server/services/students";
import { listStudents } from "@/server/services/students";
import { db, expectCode, freshElection, key, openElection, registerStudent } from "./helpers";

describe("results, turnout and exports", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;
  let students: Awaited<ReturnType<typeof registerStudent>>[];

  /** 6 students, one ineligible; 4 vote with known selections. */
  async function scenario() {
    students = [];
    for (let i = 0; i < 6; i++) students.push(await registerStudent(i));
    await setEligibility(db(), ctx.admin, students[5].voterId, false);
    await openElection(ctx.admin.adminId);
    const c = ctx.candidateIds;
    const ballots = [[c[0], c[1], c[2]], [c[0], c[1]], [c[0]], [c[3], c[4], c[5], c[6], c[7]]];
    for (let i = 0; i < ballots.length; i++) {
      await submitBallot(db(), students[i].voterId, { candidateIds: ballots[i], submissionKey: key() });
    }
    return ballots;
  }

  beforeEach(async () => {
    ctx = await freshElection();
  });

  it("empty election: zero turnout, all candidates at zero, consistent", async () => {
    const dash = await getAdminDashboard(db());
    expect(dash.turnout).toEqual({ registered: 0, eligible: 0, voted: 0, notVoted: 0, turnoutPercent: 0 });
    expect(dash.totals).toHaveLength(12);
    expect(dash.totals!.every((t) => t.votes === 0)).toBe(true);
    expect(dash.consistency.ok).toBe(true);
  });

  it("candidate totals match the raw ballot data and are sorted by votes", async () => {
    await scenario();
    const dash = await getAdminDashboard(db());
    const raw = await tallyFromDatabase(db(), ctx.election.id);
    for (const t of dash.totals!) expect(t.votes).toBe(raw.get(t.candidateId) ?? 0);
    const c = ctx.candidateIds;
    expect(dash.totals!.slice(0, 3).map((t) => [t.candidateId, t.votes])).toEqual([[c[0], 3], [c[1], 2], [c[2], 1]]);
    const votes = dash.totals!.map((t) => t.votes);
    expect(votes).toEqual([...votes].sort((a, b) => b - a));
    expect(votes.reduce((a, b) => a + b, 0)).toBe(3 + 2 + 1 + 5);
  });

  it("participation counts are consistent", async () => {
    await scenario();
    const dash = await getAdminDashboard(db());
    expect(dash.turnout).toEqual({ registered: 6, eligible: 5, voted: 4, notVoted: 1, turnoutPercent: 80 });
    expect(dash.ballots).toBe(4);
    expect(dash.consistency).toEqual({ ok: true, problems: [] });
    const voted = await listStudents(db(), { filter: "voted" });
    const notVoted = await listStudents(db(), { filter: "not_voted" });
    expect(voted.map((s) => s.id).sort()).toEqual(students.slice(0, 4).map((s) => s.voterId).sort());
    expect(notVoted.map((s) => s.id)).toEqual([students[4].voterId]);
    expect((await listStudents(db(), { filter: "ineligible" })).map((s) => s.id)).toEqual([students[5].voterId]);
  });

  it("searches students by name and registration number", async () => {
    await scenario();
    expect((await listStudents(db(), { q: "rohan" })).map((s) => s.fullName)).toEqual(["Rohan Das"]);
    expect((await listStudents(db(), { q: "dev2026003" })).map((s) => s.registrationNumber)).toEqual(["DEV2026003"]);
    expect(await listStudents(db(), { q: "%" })).toHaveLength(0);
  });

  it("hides totals during voting when results visibility is AFTER_CLOSE", async () => {
    await updateElectionConfig(db(), ctx.admin, { name: "College Election 2026", maxSelections: 5, resultsVisibility: "AFTER_CLOSE" });
    await scenario();
    const during = await getAdminDashboard(db());
    expect(during.totals).toBeNull();
    expect(during.turnout.voted).toBe(4);
    await expectCode(resultsCsv(db()), "RESULTS_HIDDEN");
    await transitionElection(db(), ctx.admin, "CLOSED");
    expect((await getAdminDashboard(db())).totals).not.toBeNull();
  });

  it("exports participation, results and audit CSVs without ballot selections", async () => {
    const ballots = await scenario();
    await transitionElection(db(), ctx.admin, "CLOSED");

    const participation = parseCsv(await participationCsv(db()));
    expect(participation[0]).toEqual(["Full name", "Registration number", "Eligible", "Voted"]);
    expect(participation).toHaveLength(7);
    const row = participation.find((r) => r[1] === students[0].registrationNumber)!;
    expect(row).toEqual([students[0].fullName, students[0].registrationNumber, "Yes", "Yes"]);
    const candidateNames = ctx.candidates.map((c) => c.name);
    for (const r of participation) for (const cell of r) expect(candidateNames).not.toContain(cell);

    const results = parseCsv(await resultsCsv(db()));
    const header = results.findIndex((r) => r[0] === "Candidate");
    const rows = results.slice(header + 1);
    expect(rows).toHaveLength(12);
    const expected = new Map<number, number>();
    for (const b of ballots) for (const id of b) expected.set(id, (expected.get(id) ?? 0) + 1);
    for (const [name, votes] of rows) {
      const cand = ctx.candidates.find((c) => c.name === name)!;
      expect(Number(votes)).toBe(expected.get(cand.id) ?? 0);
    }
    expect(results.find((r) => r[0] === "Students who voted")?.[1]).toBe("4");
    for (const s of students) expect(results.flat()).not.toContain(s.registrationNumber);

    const audit = parseCsv(await auditCsv(db()));
    expect(audit[0][3]).toBe("Action");
    expect(audit.slice(1).map((r) => r[3])).toContain("election.opened");
  });
});

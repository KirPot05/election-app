import type { Db } from "@/server/db";
import { toCsv } from "@/lib/csv";
import { AppError } from "@/server/errors";
import { listAuditEvents } from "./audit";
import { getAdminDashboard } from "./results";
import { listStudents } from "./students";

/** Name, registration number and voted status. Never ballot contents. */
export async function participationCsv(db: Db): Promise<string> {
  const students = await listStudents(db);
  return toCsv([
    ["Full name", "Registration number", "Eligible", "Voted"],
    ...students.map((s) => [s.fullName, s.registrationNumber, s.eligible ? "Yes" : "No", s.hasVoted ? "Yes" : "No"]),
  ]);
}

/** Candidate-wise totals sorted by votes, plus turnout summary. No winner is declared. */
export async function resultsCsv(db: Db): Promise<string> {
  const dash = await getAdminDashboard(db);
  if (!dash.election) throw new AppError("ELECTION_NOT_CONFIGURED", 409, "The election has not been set up yet.");
  if (!dash.totals) {
    throw new AppError("RESULTS_HIDDEN", 409, "Results are hidden until voting closes (results visibility setting).");
  }
  const t = dash.turnout;
  return toCsv([
    ["Election", dash.election.name],
    ["Status", dash.election.status],
    ["Maximum selections per ballot", dash.election.maxSelections],
    ["Registered students", t.registered],
    ["Eligible students", t.eligible],
    ["Students who voted", t.voted],
    ["Ballots recorded", dash.ballots],
    ["Turnout (%)", t.turnoutPercent],
    ["Generated at (UTC)", dash.generatedAt],
    ["Counts consistent", dash.consistency.ok ? "Yes" : `No: ${dash.consistency.problems.join(" ")}`],
    [],
    ["Candidate", "Votes"],
    ...dash.totals.map((c) => [c.name, c.votes]),
  ]);
}

export async function auditCsv(db: Db): Promise<string> {
  const events = await listAuditEvents(db, 10_000);
  return toCsv([
    ["Time (UTC)", "Actor type", "Actor id", "Action", "Target type", "Target id", "Details"],
    ...events.map((e) => [
      e.occurredAt.toISOString(),
      e.actorType,
      e.actorId,
      e.action,
      e.targetType,
      e.targetId,
      e.details ? JSON.stringify(e.details) : "",
    ]),
  ]);
}

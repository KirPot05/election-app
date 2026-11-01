import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/server/db";
import { ballotChoices, ballots, voterParticipation, voters } from "@/server/db/schema";
import { sessionCookieName } from "@/server/auth/cookies";
import { transitionElection } from "@/server/services/election";
import { signup } from "@/server/services/voters";
import { SAMPLE_STUDENTS, seedAdmin, seedElection, truncateAll } from "../../scripts/lib/fixtures";

/** The same pool the route handlers use (DATABASE_URL = TEST_DATABASE_URL). */
export function db(): Db {
  return getDb();
}

export async function resetDb() {
  await truncateAll(db());
}

/** Fresh DB with an admin and a DRAFT election (12 candidates, M = 5 by default). */
export async function freshElection(opts: Parameters<typeof seedElection>[1] = {}) {
  await resetDb();
  const admin = await seedAdmin(db(), { username: "admin", password: "test-admin-password" });
  const seeded = await seedElection(db(), opts);
  return { admin: { adminId: admin.id }, ...seeded, candidateIds: seeded.candidates.map((c) => c.id) };
}

const letters = (n: number) => n.toString(26).split("").map((d) => String.fromCharCode(65 + parseInt(d, 26))).join("");

let ipCounter = 0;
/** Registers a student through the real signup service. */
export async function registerStudent(i = 0, overrides: Partial<(typeof SAMPLE_STUDENTS)[number]> = {}) {
  const s = { ...(SAMPLE_STUDENTS[i] ?? {
    fullName: `Test Student ${letters(i)}`,
    registrationNumber: `TST${String(i).padStart(4, "0")}`,
    password: `password-${i}`,
  }), ...overrides };
  const result = await signup(db(), s, { ip: `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });
  return { ...s, voterId: result.voterId, token: result.token };
}

export async function openElection(adminId: string) {
  return transitionElection(db(), { adminId }, "OPEN");
}

export const key = () => randomUUID();

export async function countRows() {
  const d = db();
  const [[p], [b], [c], [v]] = await Promise.all([
    d.select({ n: count() }).from(voterParticipation),
    d.select({ n: count() }).from(ballots),
    d.select({ n: count() }).from(ballotChoices),
    d.select({ n: count() }).from(voters),
  ]);
  return { participation: p.n, ballots: b.n, choices: c.n, voters: v.n };
}

export async function hasVoted(voterId: string) {
  const rows = await db().select().from(voterParticipation).where(eq(voterParticipation.voterId, voterId));
  return rows.length === 1;
}

/** Builds a request for invoking route handlers directly. */
export function request(
  path: string,
  opts: { method?: string; body?: unknown; raw?: string; voterToken?: string; adminToken?: string; headers?: Record<string, string> } = {},
) {
  const cookies: string[] = [];
  if (opts.voterToken) cookies.push(`${sessionCookieName("voter")}=${opts.voterToken}`);
  if (opts.adminToken) cookies.push(`${sessionCookieName("admin")}=${opts.adminToken}`);
  const headers: Record<string, string> = { host: "localhost:3000", ...opts.headers };
  if (cookies.length) headers.cookie = cookies.join("; ");
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] ??= "application/json";
  return new NextRequest(`http://localhost:3000${path}`, {
    method: opts.method ?? (opts.body === undefined && opts.raw === undefined ? "GET" : "POST"),
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
}

/** Expects a promise to reject with an AppError of the given code. */
export async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual !== code) throw new Error(`Expected error code ${code}, got ${actual}: ${(err as Error).message}`);
    return err;
  }
  throw new Error(`Expected error code ${code}, but the promise resolved`);
}

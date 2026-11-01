/**
 * Deterministic fictional data shared by the development seed, integration
 * tests and Playwright E2E tests. Never used in production.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../../src/server/db";
import { candidates, elections } from "../../src/server/db/schema";
import { upsertAdmin } from "../../src/server/services/admin";

export const SAMPLE_ELECTION = { name: "College Election 2026", maxSelections: 5 };

export const SAMPLE_CANDIDATES: { name: string; description: string }[] = [
  { name: "Aarav Mehta", description: "Computer Science, 3rd year" },
  { name: "Bianca Fernandes", description: "Mechanical Engineering, 2nd year" },
  { name: "Chen Wei", description: "Physics, 4th year" },
  { name: "Divya Narayanan", description: "Economics, 3rd year" },
  { name: "Elias Okafor", description: "Civil Engineering, 2nd year" },
  { name: "Fatima Zahra", description: "Biotechnology, 3rd year" },
  { name: "Gaurav Singh", description: "Electronics, 4th year" },
  { name: "Hana Kobayashi", description: "Mathematics, 2nd year" },
  { name: "Ishaan Rao", description: "Chemical Engineering, 3rd year" },
  { name: "Jasmine Thomas", description: "English Literature, 2nd year" },
  { name: "Karthik Iyer", description: "Information Technology, 4th year" },
  { name: "Leila Haddad", description: "Architecture, 3rd year" },
];

const SURNAMES = ["Kapoor", "Das", "Joseph", "Malhotra", "Pillai", "Bose", "Reddy", "Khan", "Nair", "Patel",
  "Sharma", "Verma", "Gupta", "Menon", "Rao", "Shah", "Iyer", "Ali", "Chopra", "Sen"];

/** 20 fictional students: DEV2026001 .. DEV2026020, password "student-pass-01" .. */
export const SAMPLE_STUDENTS = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  const first = ["Anika", "Rohan", "Sara", "Vikram", "Meera", "Arjun", "Nisha", "Kabir", "Pooja", "Dev",
    "Isha", "Neel", "Riya", "Aditya", "Tara", "Yash", "Kavya", "Omar", "Lina", "Samir"][i];
  return {
    fullName: `${first} ${SURNAMES[i]}`,
    registrationNumber: `DEV2026${n}`,
    password: `student-pass-${n}`,
  };
});

export const DEV_ADMIN = { username: "admin", password: "dev-admin-password" };

export const ALL_TABLES = [
  "ballot_choices",
  "ballots",
  "voter_participation",
  "recovery_tokens",
  "sessions",
  "audit_events",
  "rate_limits",
  "candidates",
  "voters",
  "admin_users",
  "elections",
];

/**
 * Empties every table. TRUNCATE bypasses the row-level append-only triggers,
 * which is intended: this is only ever called on disposable databases.
 */
export async function truncateAll(db: Db) {
  await db.execute(sql.raw(`TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

/** Creates the sample election in DRAFT with `candidateCount` candidates. */
export async function seedElection(
  db: Db,
  opts: { name?: string; maxSelections?: number; candidateCount?: number } = {},
) {
  const [election] = await db
    .insert(elections)
    .values({
      name: opts.name ?? SAMPLE_ELECTION.name,
      maxSelections: opts.maxSelections ?? SAMPLE_ELECTION.maxSelections,
    })
    .returning();
  const count = opts.candidateCount ?? SAMPLE_CANDIDATES.length;
  const rows = Array.from({ length: count }, (_, i) => ({
    electionId: election.id,
    name: SAMPLE_CANDIDATES[i]?.name ?? `Candidate ${i + 1}`,
    description: SAMPLE_CANDIDATES[i]?.description ?? "",
    displayOrder: i + 1,
  }));
  const inserted = rows.length ? await db.insert(candidates).values(rows).returning() : [];
  return { election, candidates: inserted };
}

export async function seedAdmin(db: Db, admin = DEV_ADMIN) {
  return upsertAdmin(db, admin, { resetIfExists: true });
}

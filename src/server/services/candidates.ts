import { asc, eq, max } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { candidates, type Candidate } from "@/server/db/schema";
import { isConfigurationEditable } from "@/lib/election-rules";
import { isBlankRow, parseCsv } from "@/lib/csv";
import { candidateInputSchema, fieldErrors } from "@/lib/validation";
import { AppError, Errors, isIntegrityViolation, isUniqueViolation } from "@/server/errors";
import { recordAudit } from "./audit";
import { lockElection } from "./election";

export const MAX_CANDIDATES = 200;

export async function listCandidates(db: DbOrTx, electionId: number): Promise<Candidate[]> {
  return db
    .select()
    .from(candidates)
    .where(eq(candidates.electionId, electionId))
    .orderBy(asc(candidates.displayOrder), asc(candidates.id));
}

const duplicateName = () =>
  Errors.conflict("DUPLICATE_CANDIDATE", "A candidate with this name already exists.");
const locked = () =>
  Errors.conflict("CONFIG_LOCKED", "Candidates can only be changed before voting opens.");

/**
 * Every candidate mutation locks the election row FOR SHARE first, so it
 * serializes with the DRAFT -> OPEN transition (which takes FOR UPDATE).
 */
async function withDraftElection<T>(
  db: DbOrTx,
  fn: (tx: DbOrTx, electionId: number) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      const election = await lockElection(tx, "share");
      if (!election) throw Errors.notFound("Election");
      if (!isConfigurationEditable(election.status)) throw locked();
      return fn(tx, election.id);
    });
  } catch (err) {
    if (isUniqueViolation(err, "candidates_election_name_unique")) throw duplicateName();
    if (isIntegrityViolation(err)) throw locked();
    throw err;
  }
}

export async function createCandidate(
  db: DbOrTx,
  actor: { adminId: string },
  rawInput: unknown,
): Promise<Candidate> {
  const parsed = candidateInputSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));

  return withDraftElection(db, async (tx, electionId) => {
    const [{ value: maxOrder }] = await tx
      .select({ value: max(candidates.displayOrder) })
      .from(candidates)
      .where(eq(candidates.electionId, electionId));
    const existing = await listCandidates(tx, electionId);
    if (existing.length >= MAX_CANDIDATES) {
      throw Errors.conflict("TOO_MANY_CANDIDATES", `At most ${MAX_CANDIDATES} candidates are supported.`);
    }
    const [created] = await tx
      .insert(candidates)
      .values({
        electionId,
        name: parsed.data.name,
        description: parsed.data.description,
        displayOrder: (maxOrder ?? 0) + 1,
      })
      .returning();
    await recordAudit(tx, {
      actorType: "admin",
      actorId: actor.adminId,
      action: "candidate.created",
      targetType: "candidate",
      targetId: created.id,
      details: { name: created.name },
    });
    return created;
  });
}

export async function updateCandidate(
  db: DbOrTx,
  actor: { adminId: string },
  candidateId: number,
  rawInput: unknown,
): Promise<Candidate> {
  const parsed = candidateInputSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));

  return withDraftElection(db, async (tx) => {
    const [updated] = await tx
      .update(candidates)
      .set({ name: parsed.data.name, description: parsed.data.description })
      .where(eq(candidates.id, candidateId))
      .returning();
    if (!updated) throw Errors.notFound("Candidate");
    await recordAudit(tx, {
      actorType: "admin",
      actorId: actor.adminId,
      action: "candidate.updated",
      targetType: "candidate",
      targetId: candidateId,
      details: { name: updated.name },
    });
    return updated;
  });
}

export async function deleteCandidate(
  db: DbOrTx,
  actor: { adminId: string },
  candidateId: number,
): Promise<void> {
  await withDraftElection(db, async (tx) => {
    const [deleted] = await tx.delete(candidates).where(eq(candidates.id, candidateId)).returning();
    if (!deleted) throw Errors.notFound("Candidate");
    await recordAudit(tx, {
      actorType: "admin",
      actorId: actor.adminId,
      action: "candidate.deleted",
      targetType: "candidate",
      targetId: candidateId,
      details: { name: deleted.name },
    });
  });
}

export type ImportRowError = { line: number; message: string };

/**
 * Parses a candidate CSV (`name,description` with a header row). Validates
 * every row before anything is written; returns all row errors at once.
 */
export function parseCandidateCsv(text: string): {
  rows: { name: string; description: string }[];
  errors: ImportRowError[];
} {
  let table: string[][];
  try {
    table = parseCsv(text, { keepBlank: true });
    while (table.length && isBlankRow(table[0])) table.shift();
  } catch (err) {
    return { rows: [], errors: [{ line: 0, message: (err as Error).message }] };
  }
  if (table.length === 0) return { rows: [], errors: [{ line: 0, message: "The file is empty." }] };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  if (nameIdx === -1) {
    return { rows: [], errors: [{ line: 1, message: 'The first row must be a header containing a "name" column.' }] };
  }
  const descIdx = header.indexOf("description");

  const rows: { name: string; description: string }[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (isBlankRow(cells)) return;
    const parsed = candidateInputSchema.safeParse({
      name: cells[nameIdx] ?? "",
      description: descIdx === -1 ? "" : (cells[descIdx] ?? ""),
    });
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues[0].message });
      return;
    }
    const key = parsed.data.name.toLowerCase();
    if (seen.has(key)) {
      errors.push({ line, message: `Duplicate of line ${seen.get(key)}: "${parsed.data.name}".` });
      return;
    }
    seen.set(key, line);
    rows.push(parsed.data);
  });
  if (rows.length === 0 && errors.length === 0) errors.push({ line: 0, message: "No candidates found in the file." });
  if (rows.length > MAX_CANDIDATES) errors.push({ line: 0, message: `At most ${MAX_CANDIDATES} candidates are supported.` });
  return { rows, errors };
}

export async function importCandidates(
  db: DbOrTx,
  actor: { adminId: string },
  input: { csv: string; replace: boolean },
): Promise<{ imported: number }> {
  if (typeof input.csv !== "string" || input.csv.length > 200_000) {
    throw Errors.validation({ csv: "Upload a CSV file smaller than 200 KB." });
  }
  const { rows, errors } = parseCandidateCsv(input.csv);
  if (errors.length) {
    throw new AppError(
      "IMPORT_INVALID",
      400,
      errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join("\n"),
    );
  }

  return withDraftElection(db, async (tx, electionId) => {
    if (input.replace) {
      await tx.delete(candidates).where(eq(candidates.electionId, electionId));
    }
    const [{ value: maxOrder }] = await tx
      .select({ value: max(candidates.displayOrder) })
      .from(candidates)
      .where(eq(candidates.electionId, electionId));
    const base = maxOrder ?? 0;
    await tx.insert(candidates).values(
      rows.map((r, i) => ({ electionId, name: r.name, description: r.description, displayOrder: base + i + 1 })),
    );
    await recordAudit(tx, {
      actorType: "admin",
      actorId: actor.adminId,
      action: "candidate.imported",
      targetType: "election",
      targetId: electionId,
      details: { count: rows.length, replace: input.replace },
    });
    return { imported: rows.length };
  });
}

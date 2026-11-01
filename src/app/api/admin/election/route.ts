import { getDb } from "@/server/db";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { createElection, updateElectionConfig } from "@/server/services/election";

export const dynamic = "force-dynamic";

/** Initialize the election (only when none exists). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const db = getDb();
  const admin = await requireAdmin(req, db);
  return json({ ok: true, election: await createElection(db, admin, body) }, 201);
});

/** Update name, maximum selections and results visibility (DRAFT only). */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  const db = getDb();
  const admin = await requireAdmin(req, db);
  return json({ ok: true, election: await updateElectionConfig(db, admin, body) });
});

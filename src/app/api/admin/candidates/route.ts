import { getDb } from "@/server/db";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { createCandidate, listCandidates } from "@/server/services/candidates";
import { requireElection } from "@/server/services/election";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const db = getDb();
  await requireAdmin(req, db);
  const election = await requireElection(db);
  return json({ candidates: await listCandidates(db, election.id) });
});

export const POST = route(async (req) => {
  const body = await readJson(req);
  const db = getDb();
  const admin = await requireAdmin(req, db);
  return json({ ok: true, candidate: await createCandidate(db, admin, body) }, 201);
});

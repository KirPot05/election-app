import { getDb } from "@/server/db";
import { json, readJson, requireVoter, route } from "@/server/http";
import { submitBallot } from "@/server/services/ballot";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const body = await readJson(req);
  const db = getDb();
  const principal = await requireVoter(req, db);
  const result = await submitBallot(db, principal.voterId, body);
  return json({ ok: true, status: result.status }, result.status === "RECORDED" ? 201 : 200);
});

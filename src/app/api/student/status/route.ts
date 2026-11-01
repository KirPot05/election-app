import { getDb } from "@/server/db";
import { json, requireVoter, route } from "@/server/http";
import { getVoterStatus } from "@/server/services/voters";

export const dynamic = "force-dynamic";

/** Polled by the student dashboard. Contains no vote totals. */
export const GET = route(async (req) => {
  const db = getDb();
  const principal = await requireVoter(req, db);
  return json(await getVoterStatus(db, principal.voterId));
});

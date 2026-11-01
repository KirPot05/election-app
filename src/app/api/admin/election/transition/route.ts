import { getDb } from "@/server/db";
import { fieldErrors, transitionSchema } from "@/lib/validation";
import { Errors } from "@/server/errors";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { transitionElection } from "@/server/services/election";

export const dynamic = "force-dynamic";

/** Start, stop or finalize voting. Requires { to, confirm: true }. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const db = getDb();
  const admin = await requireAdmin(req, db);
  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));
  const election = await transitionElection(db, admin, parsed.data.to);
  return json({ ok: true, status: election.status });
});

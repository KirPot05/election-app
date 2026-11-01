import { getDb } from "@/server/db";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { importCandidates } from "@/server/services/candidates";

export const dynamic = "force-dynamic";

/** Body: { csv: string, replace: boolean }. All rows are validated before any write. */
export const POST = route(async (req) => {
  const body = (await readJson(req)) as { csv?: unknown; replace?: unknown };
  const db = getDb();
  const admin = await requireAdmin(req, db);
  const result = await importCandidates(db, admin, {
    csv: typeof body.csv === "string" ? body.csv : "",
    replace: body.replace === true,
  });
  return json({ ok: true, ...result });
});

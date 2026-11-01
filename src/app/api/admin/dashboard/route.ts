import { getDb } from "@/server/db";
import { json, requireAdmin, route } from "@/server/http";
import { getAdminDashboard } from "@/server/services/results";

export const dynamic = "force-dynamic";

/** Live turnout and candidate totals (aggregates only), polled every few seconds. */
export const GET = route(async (req) => {
  const db = getDb();
  await requireAdmin(req, db);
  return json(await getAdminDashboard(db));
});

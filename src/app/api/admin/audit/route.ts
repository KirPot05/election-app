import { getDb } from "@/server/db";
import { json, requireAdmin, route } from "@/server/http";
import { listAuditEvents } from "@/server/services/audit";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const db = getDb();
  await requireAdmin(req, db);
  return json({ events: await listAuditEvents(db, 200) });
});

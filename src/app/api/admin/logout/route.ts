import { getDb } from "@/server/db";
import { revokeSessionByToken, validateAdminSession } from "@/server/auth/session";
import { clearSessionCookie, json, readJson, readSessionToken, route } from "@/server/http";
import { recordAudit } from "@/server/services/audit";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  await readJson(req);
  const db = getDb();
  const token = readSessionToken(req, "admin");
  const admin = await validateAdminSession(db, token);
  await revokeSessionByToken(db, token);
  if (admin) await recordAudit(db, { actorType: "admin", actorId: admin.adminId, action: "admin.logout" });
  const res = json({ ok: true, redirect: "/admin/login" });
  clearSessionCookie(res, "admin");
  return res;
});

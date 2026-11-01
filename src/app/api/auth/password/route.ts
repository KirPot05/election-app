import { getDb } from "@/server/db";
import { json, readJson, requireVoter, route, setSessionCookie } from "@/server/http";
import { changePassword } from "@/server/services/voters";

export const dynamic = "force-dynamic";

/** Change password; other sessions are revoked and this one is rotated. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const db = getDb();
  const principal = await requireVoter(req, db);
  const session = await changePassword(db, principal, body);
  const res = json({ ok: true });
  setSessionCookie(res, "voter", session.token, session.expiresAt);
  return res;
});

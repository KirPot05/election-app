import { getDb } from "@/server/db";
import { revokeSessionByToken } from "@/server/auth/session";
import { clearSessionCookie, json, readJson, readSessionToken, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  await readJson(req);
  await revokeSessionByToken(getDb(), readSessionToken(req, "voter"));
  const res = json({ ok: true, redirect: "/login" });
  clearSessionCookie(res, "voter");
  return res;
});

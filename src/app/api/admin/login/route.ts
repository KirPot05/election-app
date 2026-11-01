import { getDb } from "@/server/db";
import { clientIp, json, readJson, route, setSessionCookie } from "@/server/http";
import { adminLogin } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const body = await readJson(req);
  const result = await adminLogin(getDb(), body, { ip: clientIp(req) });
  const res = json({ ok: true, redirect: "/admin" });
  setSessionCookie(res, "admin", result.token, result.expiresAt);
  return res;
});

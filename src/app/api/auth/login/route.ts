import { getDb } from "@/server/db";
import { clientIp, json, readJson, route, setSessionCookie } from "@/server/http";
import { login } from "@/server/services/voters";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const body = await readJson(req);
  const result = await login(getDb(), body, { ip: clientIp(req) });
  const res = json({ ok: true, redirect: "/dashboard" });
  setSessionCookie(res, "voter", result.token, result.expiresAt);
  return res;
});

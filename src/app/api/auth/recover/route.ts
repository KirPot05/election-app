import { getDb } from "@/server/db";
import { clearSessionCookie, clientIp, json, readJson, route } from "@/server/http";
import { redeemRecoveryToken } from "@/server/services/recovery";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const body = await readJson(req);
  const result = await redeemRecoveryToken(getDb(), body, { ip: clientIp(req) });
  const res = json({ ok: true, registrationNumber: result.registrationNumber });
  clearSessionCookie(res, "voter");
  return res;
});

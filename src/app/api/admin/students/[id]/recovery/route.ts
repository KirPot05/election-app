import { getDb } from "@/server/db";
import { config } from "@/server/config";
import { Errors } from "@/server/errors";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { issueRecoveryToken } from "@/server/services/recovery";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Issues a single-use recovery link. The token is in the URL fragment, so it
 * is never sent to the server in a request line or logged by proxies.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = (await readJson(req)) as { confirm?: unknown };
  if (body.confirm !== true) throw Errors.validation({ confirm: "Confirmation is required." });
  const db = getDb();
  const admin = await requireAdmin(req, db);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound("Student");
  const result = await issueRecoveryToken(db, admin, id);
  const base = config.appUrl ?? req.nextUrl.origin;
  return json({
    ok: true,
    recoveryUrl: `${base}/reset-password#${result.token}`,
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    student: result.voter,
  });
});

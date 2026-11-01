import { getDb } from "@/server/db";
import { Errors } from "@/server/errors";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { setEligibility } from "@/server/services/students";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const body = (await readJson(req)) as { eligible?: unknown };
  const db = getDb();
  const admin = await requireAdmin(req, db);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound("Student");
  await setEligibility(db, admin, id, body.eligible as boolean);
  return json({ ok: true });
});

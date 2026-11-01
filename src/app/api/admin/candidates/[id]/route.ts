import { getDb } from "@/server/db";
import { Errors } from "@/server/errors";
import { json, readJson, requireAdmin, route } from "@/server/http";
import { deleteCandidate, updateCandidate } from "@/server/services/candidates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function candidateId(ctx: Ctx) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw Errors.notFound("Candidate");
  return id;
}

export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const db = getDb();
  const admin = await requireAdmin(req, db);
  return json({ ok: true, candidate: await updateCandidate(db, admin, await candidateId(ctx), body) });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  await readJson(req);
  const db = getDb();
  const admin = await requireAdmin(req, db);
  await deleteCandidate(db, admin, await candidateId(ctx));
  return json({ ok: true });
});

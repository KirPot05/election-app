import { getDb } from "@/server/db";
import { Errors } from "@/server/errors";
import { csv, requireAdmin, route } from "@/server/http";
import { auditCsv, participationCsv, resultsCsv } from "@/server/services/export";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

const EXPORTS = {
  "participation.csv": participationCsv,
  "results.csv": resultsCsv,
  "audit.csv": auditCsv,
} as const;

export const GET = route<Ctx>(async (req, ctx) => {
  const db = getDb();
  await requireAdmin(req, db);
  const { kind } = await ctx.params;
  const build = Object.hasOwn(EXPORTS, kind) ? EXPORTS[kind as keyof typeof EXPORTS] : undefined;
  if (!build) throw Errors.notFound("Export");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return csv(await build(db), kind.replace(".csv", `-${stamp}.csv`));
});

import { getDb } from "@/server/db";
import { json, requireAdmin, route } from "@/server/http";
import { listStudents, type StudentFilter } from "@/server/services/students";

export const dynamic = "force-dynamic";

const FILTERS: StudentFilter[] = ["all", "voted", "not_voted", "ineligible"];

export const GET = route(async (req) => {
  const db = getDb();
  await requireAdmin(req, db);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const f = req.nextUrl.searchParams.get("filter") as StudentFilter | null;
  const students = await listStudents(db, { q, filter: f && FILTERS.includes(f) ? f : "all" });
  return json({ students });
});

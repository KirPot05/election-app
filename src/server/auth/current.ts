import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { sessionCookieName } from "./cookies";
import { validateAdminSession, validateVoterSession } from "./session";

/**
 * Session lookups for Server Components. Reading cookies() makes every page
 * that calls these render dynamically per request (never cached).
 */
export async function getCurrentVoter() {
  const token = (await cookies()).get(sessionCookieName("voter"))?.value;
  return validateVoterSession(getDb(), token);
}

export async function requireVoterPage() {
  const voter = await getCurrentVoter();
  if (!voter) redirect("/login");
  return voter;
}

export async function getCurrentAdmin() {
  const token = (await cookies()).get(sessionCookieName("admin"))?.value;
  return validateAdminSession(getDb(), token);
}

export async function requireAdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

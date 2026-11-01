import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { adminUsers } from "@/server/db/schema";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { adminLoginSchema, adminPasswordSchema, adminUsernameSchema, fieldErrors } from "@/lib/validation";
import { AppError, Errors } from "@/server/errors";
import { recordAudit } from "./audit";
import { check, consume, RATE_LIMITS, reset } from "./rate-limit";

const invalidAdminCredentials = () =>
  new AppError("INVALID_CREDENTIALS", 401, "Incorrect username or password.");

export async function adminLogin(db: DbOrTx, rawInput: unknown, ctx: { ip: string }) {
  const parsed = adminLoginSchema.safeParse(rawInput);
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error));
  const { username, password } = parsed.data;

  const ipLimit = await consume(db, `admin-login:ip:${ctx.ip}`, RATE_LIMITS.adminLoginPerIp);
  if (!ipLimit.allowed) throw Errors.rateLimited(ipLimit.retryAfterSeconds);
  const accountKey = `admin-login:account:${username}`;
  const accountLimit = await check(db, accountKey, RATE_LIMITS.adminLoginPerAccount);
  if (!accountLimit.allowed) throw Errors.rateLimited(accountLimit.retryAfterSeconds);

  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);
  const ok = admin ? await verifyPassword(admin.passwordHash, password) : await verifyAgainstDummy(password);
  if (!admin || !ok) {
    await consume(db, accountKey, RATE_LIMITS.adminLoginPerAccount);
    throw invalidAdminCredentials();
  }
  await reset(db, accountKey);
  const session = await createSession(db, "admin", admin.id);
  await recordAudit(db, { actorType: "admin", actorId: admin.id, action: "admin.login" });
  return { adminId: admin.id, ...session };
}

/**
 * Creates an administrator or, with `resetIfExists`, replaces an existing
 * administrator's password. Used by the `admin:create` CLI and test fixtures;
 * there is intentionally no web endpoint for creating administrators.
 */
export async function upsertAdmin(
  db: DbOrTx,
  input: { username: string; password: string },
  opts: { resetIfExists?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  const username = adminUsernameSchema.safeParse(input.username);
  if (!username.success) throw Errors.validation({ username: username.error.issues[0].message });
  const password = adminPasswordSchema.safeParse(input.password);
  if (!password.success) throw Errors.validation({ password: password.error.issues[0].message });

  const passwordHash = await hashPassword(password.data);
  const [existing] = await db.select().from(adminUsers).where(eq(adminUsers.username, username.data)).limit(1);
  if (existing) {
    if (!opts.resetIfExists) {
      throw Errors.conflict("ADMIN_EXISTS", `Administrator "${username.data}" already exists.`);
    }
    await db.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [created] = await db
    .insert(adminUsers)
    .values({ username: username.data, passwordHash })
    .returning({ id: adminUsers.id });
  return { id: created.id, created: true };
}

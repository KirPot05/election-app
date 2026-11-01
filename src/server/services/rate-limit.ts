import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { rateLimits } from "@/server/db/schema";
import { hashToken } from "@/server/auth/tokens";

/**
 * Fixed-window counters in PostgreSQL (no Redis needed). Keys are hashed so
 * raw IP addresses and registration numbers are never stored here.
 */
export type RateLimitRule = { limit: number; windowSeconds: number };

const minutes = (n: number) => n * 60;

function envInt(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const RATE_LIMITS = {
  /** Failed student logins per registration number. */
  voterLoginPerAccount: { limit: 10, windowSeconds: minutes(15) } as RateLimitRule,
  /** Student login attempts per IP. High because a campus shares NAT IPs. */
  get voterLoginPerIp(): RateLimitRule {
    return { limit: envInt("LOGIN_LIMIT_PER_IP", 200), windowSeconds: minutes(15) };
  },
  /** Signups per IP per hour (abuse protection; shared campus IPs considered). */
  get signupPerIp(): RateLimitRule {
    return { limit: envInt("SIGNUP_LIMIT_PER_IP", 150), windowSeconds: minutes(60) };
  },
  adminLoginPerAccount: { limit: 5, windowSeconds: minutes(15) } as RateLimitRule,
  adminLoginPerIp: { limit: 30, windowSeconds: minutes(15) } as RateLimitRule,
  recoveryIssuePerAdmin: { limit: 30, windowSeconds: minutes(60) } as RateLimitRule,
  recoveryIssuePerVoter: { limit: 5, windowSeconds: minutes(60) } as RateLimitRule,
  recoveryRedeemPerIp: { limit: 30, windowSeconds: minutes(15) } as RateLimitRule,
  passwordChangePerVoter: { limit: 10, windowSeconds: minutes(15) } as RateLimitRule,
};

function storageKey(key: string) {
  return hashToken(`rate-limit:${key}`);
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Atomically counts one event and reports whether it is within the limit. */
export async function consume(db: DbOrTx, key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const k = storageKey(key);
  const window = `${rule.windowSeconds} seconds`;
  const result = await db.execute<{ count: number; window_start: Date | string }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${k}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start <= now() - ${window}::interval
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start <= now() - ${window}::interval
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count, window_start
  `);
  const row = result.rows[0];
  const allowed = Number(row.count) <= rule.limit;
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : retryAfter(new Date(row.window_start), rule),
  };
}

/** Reads the current count without incrementing it. */
export async function check(db: DbOrTx, key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, storageKey(key)))
    .limit(1);
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  const expired = row.windowStart.getTime() + rule.windowSeconds * 1000 <= Date.now();
  if (expired || row.count < rule.limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: retryAfter(row.windowStart, rule) };
}

export async function reset(db: DbOrTx, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, storageKey(key)));
}

function retryAfter(windowStart: Date, rule: RateLimitRule) {
  const ms = windowStart.getTime() + rule.windowSeconds * 1000 - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
}

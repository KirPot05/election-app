import { DEFAULT_REGISTRATION_PATTERN } from "@/lib/validation";

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

/** Runtime configuration, read lazily so tests can adjust process.env. */
export const config = {
  get isProduction() {
    return (
      process.env.APP_ENV === "production" ||
      process.env.VERCEL_ENV === "production" ||
      (process.env.NODE_ENV === "production" && process.env.APP_ENV !== "test")
    );
  },
  /** Secure cookies everywhere except an explicit local-HTTP opt-out. */
  get secureCookies() {
    if (process.env.VERCEL) return true;
    if (process.env.ALLOW_INSECURE_COOKIES === "true") return false;
    return process.env.NODE_ENV === "production";
  },
  get registrationPattern() {
    return process.env.REGISTRATION_NUMBER_PATTERN || DEFAULT_REGISTRATION_PATTERN;
  },
  get voterSessionHours() {
    return intFromEnv("VOTER_SESSION_HOURS", 24 * 7, 1, 24 * 60);
  },
  get adminSessionHours() {
    return intFromEnv("ADMIN_SESSION_HOURS", 12, 1, 24 * 7);
  },
  get recoveryTokenMinutes() {
    return intFromEnv("RECOVERY_TOKEN_MINUTES", 15, 1, 24 * 60);
  },
  get appUrl() {
    return process.env.APP_URL?.replace(/\/+$/, "") || null;
  },
};

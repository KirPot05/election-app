/**
 * Expected, user-facing failures. Anything else is treated as an internal
 * error and reported with a generic message.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  validation: (fields: Record<string, string>, message = "Please correct the highlighted fields.") =>
    new AppError("VALIDATION", 400, message, fields),
  unauthenticated: () => new AppError("UNAUTHENTICATED", 401, "Please log in to continue."),
  forbidden: () => new AppError("FORBIDDEN", 403, "You are not allowed to do that."),
  invalidCredentials: () =>
    new AppError("INVALID_CREDENTIALS", 401, "Incorrect registration number or password."),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      "RATE_LIMITED",
      429,
      `Too many attempts. Please wait ${Math.ceil(retryAfterSeconds / 60)} minute(s) and try again.`,
    ),
  notFound: (what = "Item") => new AppError("NOT_FOUND", 404, `${what} not found.`),
  conflict: (code: string, message: string) => new AppError(code, 409, message),
};

/** PostgreSQL unique_violation. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = findPgError(err);
  return !!e && e.code === "23505" && (!constraint || e.constraint === constraint);
}

/** Errors raised by our integrity triggers (see drizzle/0001_integrity_triggers.sql). */
export function isIntegrityViolation(err: unknown): boolean {
  const e = findPgError(err);
  return !!e && e.code === "P0001" && typeof e.message === "string" && e.message.startsWith("integrity:");
}

type PgError = { code?: string; constraint?: string; message?: string };

/** Drizzle wraps driver errors; walk the `cause` chain to find the pg error. */
function findPgError(err: unknown): PgError | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const c = current as PgError & { cause?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    current = c.cause;
  }
  return null;
}

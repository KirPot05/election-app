import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, base64url encoded (43 characters). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Tokens are high-entropy random values, so a fast hash is sufficient: the
 * database only stores SHA-256(token), and a database leak doesn't expose
 * usable session or recovery tokens.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

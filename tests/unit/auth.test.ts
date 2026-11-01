import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { isSessionExpired, sessionTtlMs } from "@/server/auth/session";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/cookies";
import { assertSameOrigin, clientIp } from "@/server/http";

describe("password hashing", () => {
  it("produces salted Argon2id hashes that verify only the right password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b); // unique salt
    expect(await verifyPassword(a, "correct horse battery")).toBe(true);
    expect(await verifyPassword(a, "correct horse batterY")).toBe(false);
    expect(await verifyPassword(a, "")).toBe(false);
  });

  it("treats malformed hashes as a failed verification", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("dummy verification always fails", async () => {
    expect(await verifyAgainstDummy("anything")).toBe(false);
  });
});

describe("tokens", () => {
  it("are 256-bit base64url and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
    for (const t of [...tokens].slice(0, 10)) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hash deterministically to hex SHA-256 that does not contain the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });
});

describe("session expiry", () => {
  afterEach(() => {
    delete process.env.VOTER_SESSION_HOURS;
  });

  it("is expired at or after expiresAt", () => {
    const now = new Date("2026-03-01T10:00:00Z");
    expect(isSessionExpired(new Date("2026-03-01T10:00:01Z"), now)).toBe(false);
    expect(isSessionExpired(new Date("2026-03-01T10:00:00Z"), now)).toBe(true);
    expect(isSessionExpired(new Date("2026-03-01T09:59:59Z"), now)).toBe(true);
  });

  it("uses 7 days for students and 12 hours for admins by default, configurable", () => {
    expect(sessionTtlMs("voter")).toBe(7 * 24 * 3600 * 1000);
    expect(sessionTtlMs("admin")).toBe(12 * 3600 * 1000);
    process.env.VOTER_SESSION_HOURS = "48";
    expect(sessionTtlMs("voter")).toBe(48 * 3600 * 1000);
    process.env.VOTER_SESSION_HOURS = "0";
    expect(() => sessionTtlMs("voter")).toThrow();
  });
});

describe("cookies", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("are HttpOnly with SameSite; Secure and __Host- prefix in production", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.ALLOW_INSECURE_COOKIES;
    expect(sessionCookieName("voter")).toBe("__Host-ev_session");
    const opts = sessionCookieOptions("voter", new Date());
    expect(opts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(sessionCookieOptions("admin", new Date()).sameSite).toBe("strict");
  });

  it("Vercel always forces Secure, even if the insecure override is set", () => {
    process.env.VERCEL = "1";
    process.env.ALLOW_INSECURE_COOKIES = "true";
    expect(sessionCookieOptions("voter", new Date()).secure).toBe(true);
  });

  it("local development uses plain names over HTTP", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    delete process.env.VERCEL;
    expect(sessionCookieName("admin")).toBe("ev_admin");
    expect(sessionCookieOptions("admin", new Date()).secure).toBe(false);
  });
});

describe("request helpers", () => {
  const req = (headers: Record<string, string>) => new NextRequest("http://localhost:3000/api/x", { method: "POST", headers });

  it("accepts same-origin and rejects cross-origin requests", () => {
    expect(() => assertSameOrigin(req({ host: "app.example", origin: "https://app.example" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ host: "app.example" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ host: "app.example", origin: "https://evil.example" }))).toThrow();
    expect(() => assertSameOrigin(req({ host: "app.example", origin: "null" }))).toThrow();
    expect(() => assertSameOrigin(req({ host: "app.example", "sec-fetch-site": "cross-site" }))).toThrow();
    expect(() => assertSameOrigin(req({ host: "app.example", "sec-fetch-site": "same-origin" }))).not.toThrow();
  });

  it("uses the first forwarded IP", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

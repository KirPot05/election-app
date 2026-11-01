import { config } from "@/server/config";
import type { SessionKind } from "./session";

/**
 * Cookie names. With Secure cookies the `__Host-` prefix makes the browser
 * enforce Secure, Path=/ and no Domain attribute.
 */
export function sessionCookieName(kind: SessionKind): string {
  const base = kind === "voter" ? "ev_session" : "ev_admin";
  return config.secureCookies ? `__Host-${base}` : base;
}

export function sessionCookieOptions(kind: SessionKind, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    // The admin cookie is never sent on cross-site requests. The student
    // cookie is Lax so that following a link opens the app already logged in.
    sameSite: kind === "admin" ? ("strict" as const) : ("lax" as const),
    path: "/",
    expires: expiresAt,
  };
}

export function clearedCookieOptions(kind: SessionKind) {
  return { ...sessionCookieOptions(kind, new Date(0)), maxAge: 0 };
}

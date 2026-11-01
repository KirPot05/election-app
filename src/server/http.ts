import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@/server/db";
import { clearedCookieOptions, sessionCookieName, sessionCookieOptions } from "@/server/auth/cookies";
import {
  validateAdminSession,
  validateVoterSession,
  type AdminPrincipal,
  type SessionKind,
  type VoterPrincipal,
} from "@/server/auth/session";
import { AppError, Errors } from "@/server/errors";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 256 * 1024;

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function csv(body: string, filename: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const res = json({ error: { code: err.code, message: err.message, fields: err.fields } }, err.status);
    if (err.status === 429) res.headers.set("Retry-After", "60");
    return res;
  }
  // Log only coarse metadata. Driver/ORM error messages can embed query
  // parameters, which for ballot inserts would include candidate ids.
  const e = err as { name?: string; code?: string; cause?: { code?: string; constraint?: string } };
  console.error("[api] unexpected error", {
    name: e?.name,
    code: e?.code ?? e?.cause?.code,
    constraint: e?.cause?.constraint,
  });
  return json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, 500);
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler with uniform error handling. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * CSRF defense for state-changing requests. Session cookies are SameSite
 * (Lax/Strict), every mutation requires a JSON body (which a cross-site HTML
 * form cannot send), and the Origin header, when present, must match the host.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) throw new AppError("BAD_ORIGIN", 403, "Cross-site request blocked.");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new AppError("BAD_ORIGIN", 403, "Cross-site request blocked.");
  }
}

/** Parses a JSON request body (mutations only). */
export async function readJson(req: NextRequest): Promise<unknown> {
  assertSameOrigin(req);
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", 415, "Requests must be sent as JSON.");
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", 413, "Request is too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("BAD_JSON", 400, "Malformed request.");
  }
}

/**
 * Client IP for rate limiting. On Vercel, x-forwarded-for is set by the edge
 * network and cannot be spoofed by the client.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

export function readSessionToken(req: NextRequest, kind: SessionKind): string | undefined {
  return req.cookies.get(sessionCookieName(kind))?.value;
}

export async function requireVoter(req: NextRequest, db: Db = getDb()): Promise<VoterPrincipal> {
  const principal = await validateVoterSession(db, readSessionToken(req, "voter"));
  if (!principal) throw Errors.unauthenticated();
  return principal;
}

export async function requireAdmin(req: NextRequest, db: Db = getDb()): Promise<AdminPrincipal> {
  const principal = await validateAdminSession(db, readSessionToken(req, "admin"));
  if (!principal) throw Errors.unauthenticated();
  return principal;
}

export function setSessionCookie(res: NextResponse, kind: SessionKind, token: string, expiresAt: Date) {
  res.cookies.set(sessionCookieName(kind), token, sessionCookieOptions(kind, expiresAt));
}

export function clearSessionCookie(res: NextResponse, kind: SessionKind) {
  res.cookies.set(sessionCookieName(kind), "", clearedCookieOptions(kind));
}

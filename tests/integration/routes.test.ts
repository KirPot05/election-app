import { beforeEach, describe, expect, it } from "vitest";
import { POST as adminLoginRoute } from "@/app/api/admin/login/route";
import { GET as dashboardRoute } from "@/app/api/admin/dashboard/route";
import { POST as transitionRoute } from "@/app/api/admin/election/transition/route";
import { PATCH as electionPatchRoute } from "@/app/api/admin/election/route";
import { GET as candidatesGet, POST as candidatesPost } from "@/app/api/admin/candidates/route";
import { POST as candidatesImport } from "@/app/api/admin/candidates/import/route";
import { DELETE as candidateDelete, PATCH as candidatePatch } from "@/app/api/admin/candidates/[id]/route";
import { GET as studentsGet } from "@/app/api/admin/students/route";
import { POST as recoveryRoute } from "@/app/api/admin/students/[id]/recovery/route";
import { POST as eligibilityRoute } from "@/app/api/admin/students/[id]/eligibility/route";
import { GET as exportRoute } from "@/app/api/admin/export/[kind]/route";
import { GET as auditRoute } from "@/app/api/admin/audit/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as recoverRoute } from "@/app/api/auth/recover/route";
import { GET as statusRoute } from "@/app/api/student/status/route";
import { POST as ballotRoute } from "@/app/api/student/ballot/route";
import { sessionCookieName } from "@/server/auth/cookies";
import { countRows, freshElection, key, openElection, registerStudent, request } from "./helpers";

type AnyRoute = (req: ReturnType<typeof request>, ctx: never) => Promise<Response>;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) }) as never;

async function adminToken() {
  const res = await adminLoginRoute(request("/api/admin/login", { body: { username: "admin", password: "test-admin-password" } }), undefined as never);
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  return decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
}

describe("HTTP layer: authorization, CSRF and cookies", () => {
  let ctx: Awaited<ReturnType<typeof freshElection>>;

  beforeEach(async () => {
    ctx = await freshElection();
  });

  it("every admin endpoint rejects anonymous and student callers", async () => {
    const student = await registerStudent(0);
    const id = student.voterId;
    const cases: [AnyRoute, string, unknown, unknown][] = [
      [dashboardRoute as AnyRoute, "/api/admin/dashboard", undefined, undefined],
      [transitionRoute as AnyRoute, "/api/admin/election/transition", { to: "OPEN", confirm: true }, undefined],
      [electionPatchRoute as AnyRoute, "/api/admin/election", { name: "Hacked", maxSelections: 1 }, undefined],
      [candidatesGet as AnyRoute, "/api/admin/candidates", undefined, undefined],
      [candidatesPost as AnyRoute, "/api/admin/candidates", { name: "Intruder" }, undefined],
      [candidatesImport as AnyRoute, "/api/admin/candidates/import", { csv: "name\nX\n", replace: true }, undefined],
      [candidatePatch as AnyRoute, `/api/admin/candidates/${ctx.candidateIds[0]}`, { name: "X" }, params({ id: String(ctx.candidateIds[0]) })],
      [candidateDelete as AnyRoute, `/api/admin/candidates/${ctx.candidateIds[0]}`, {}, params({ id: String(ctx.candidateIds[0]) })],
      [studentsGet as AnyRoute, "/api/admin/students", undefined, undefined],
      [recoveryRoute as AnyRoute, `/api/admin/students/${id}/recovery`, { confirm: true }, params({ id })],
      [eligibilityRoute as AnyRoute, `/api/admin/students/${id}/eligibility`, { eligible: false }, params({ id })],
      [exportRoute as AnyRoute, "/api/admin/export/results.csv", undefined, params({ kind: "results.csv" })],
      [exportRoute as AnyRoute, "/api/admin/export/participation.csv", undefined, params({ kind: "participation.csv" })],
      [auditRoute as AnyRoute, "/api/admin/audit", undefined, undefined],
    ];
    for (const [handler, path, body, c] of cases) {
      for (const voterToken of [undefined, student.token]) {
        const method = handler === candidateDelete ? "DELETE" : handler === candidatePatch || handler === electionPatchRoute ? "PATCH" : undefined;
        const res = await handler(request(path, { body, voterToken, method }), c as never);
        expect(res.status, `${path} (${voterToken ? "student" : "anonymous"})`).toBe(401);
        expect(res.headers.get("cache-control")).toContain("no-store");
      }
    }
    // Nothing changed.
    const t = await adminToken();
    const dash = await (await dashboardRoute(request("/api/admin/dashboard", { adminToken: t }), undefined as never)).json();
    expect(dash.election.status).toBe("DRAFT");
    expect(dash.election.name).toBe("College Election 2026");
    expect(dash.election.candidateCount).toBe(12);
  });

  it("student endpoints require a student session", async () => {
    const t = await adminToken();
    expect((await statusRoute(request("/api/student/status"), undefined as never)).status).toBe(401);
    expect((await statusRoute(request("/api/student/status", { adminToken: t }), undefined as never)).status).toBe(401);
    const res = await ballotRoute(request("/api/student/ballot", { body: { candidateIds: [ctx.candidateIds[0]], submissionKey: key() }, adminToken: t }), undefined as never);
    expect(res.status).toBe(401);
  });

  it("blocks cross-origin mutations and non-JSON bodies", async () => {
    const crossSite = await signupRoute(
      request("/api/auth/signup", {
        body: { fullName: "Cross Site", registrationNumber: "XS001", password: "password-123" },
        headers: { origin: "https://evil.example" },
      }),
      undefined as never,
    );
    expect(crossSite.status).toBe(403);
    const form = await signupRoute(
      request("/api/auth/signup", {
        body: { fullName: "Cross Site", registrationNumber: "XS001", password: "password-123" },
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      undefined as never,
    );
    expect(form.status).toBe(415);
    const fetchSite = await loginRoute(
      request("/api/auth/login", { body: { registrationNumber: "X", password: "y" }, headers: { "sec-fetch-site": "cross-site" } }),
      undefined as never,
    );
    expect(fetchSite.status).toBe(403);
    expect((await countRows()).voters).toBe(0);
  });

  it("signup sets an HttpOnly SameSite session cookie and never returns secrets", async () => {
    const res = await signupRoute(
      request("/api/auth/signup", {
        body: { fullName: "Cookie Check", registrationNumber: "CK001", password: "password-123" },
        headers: { origin: "http://localhost:3000" },
      }),
      undefined as never,
    );
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${sessionCookieName("voter")}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);
    const text = await res.text();
    expect(text).not.toMatch(/argon2|password_hash|passwordHash/);
  });

  it("full HTTP flow: login, status, vote, idempotent retry, duplicate, logout", async () => {
    const s = await registerStudent(0);
    await openElection(ctx.admin.adminId);
    const loginRes = await loginRoute(request("/api/auth/login", { body: { registrationNumber: s.registrationNumber, password: s.password } }), undefined as never);
    expect(loginRes.status).toBe(200);
    const token = decodeURIComponent(loginRes.headers.get("set-cookie")!.split(";")[0].split("=").slice(1).join("="));

    const status = await (await statusRoute(request("/api/student/status", { voterToken: token }), undefined as never)).json();
    expect(status).toMatchObject({ screen: "BALLOT", hasVoted: false, election: { status: "OPEN", maxSelections: 5 } });
    expect(JSON.stringify(status)).not.toMatch(/votes|totals/);

    const body = { candidateIds: ctx.candidateIds.slice(0, 5), submissionKey: key() };
    expect((await ballotRoute(request("/api/student/ballot", { body, voterToken: token }), undefined as never)).status).toBe(201);
    const retry = await ballotRoute(request("/api/student/ballot", { body, voterToken: token }), undefined as never);
    expect(retry.status).toBe(200);
    expect((await retry.json()).status).toBe("ALREADY_RECORDED");
    const dup = await ballotRoute(request("/api/student/ballot", { body: { ...body, submissionKey: key() }, voterToken: token }), undefined as never);
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("ALREADY_VOTED");
    expect(await countRows()).toMatchObject({ participation: 1, ballots: 1, choices: 5 });

    const out = await logoutRoute(request("/api/auth/logout", { body: {}, voterToken: token }), undefined as never);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect((await statusRoute(request("/api/student/status", { voterToken: token }), undefined as never)).status).toBe(401);
  });

  it("admin can drive the lifecycle and recovery over HTTP", async () => {
    const s = await registerStudent(0);
    const t = await adminToken();
    const noConfirm = await transitionRoute(request("/api/admin/election/transition", { body: { to: "OPEN" }, adminToken: t }), undefined as never);
    expect(noConfirm.status).toBe(400);
    const open = await transitionRoute(request("/api/admin/election/transition", { body: { to: "OPEN", confirm: true }, adminToken: t }), undefined as never);
    expect((await open.json()).status).toBe("OPEN");

    const rec = await recoveryRoute(request(`/api/admin/students/${s.voterId}/recovery`, { body: { confirm: true }, adminToken: t }), params({ id: s.voterId }));
    expect(rec.status).toBe(200);
    const { recoveryUrl, token } = await rec.json();
    expect(recoveryUrl).toBe(`http://localhost:3000/reset-password#${token}`);

    const redeem = await recoverRoute(request("/api/auth/recover", { body: { token, newPassword: "new-password-1", confirmPassword: "new-password-1" } }), undefined as never);
    expect(redeem.status).toBe(200);
    const again = await recoverRoute(request("/api/auth/recover", { body: { token, newPassword: "new-password-2", confirmPassword: "new-password-2" } }), undefined as never);
    expect(again.status).toBe(400);

    const csvRes = await exportRoute(request("/api/admin/export/participation.csv", { adminToken: t }), params({ kind: "participation.csv" }));
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("content-disposition")).toMatch(/attachment; filename="participation-.*\.csv"/);
    const unknown = await exportRoute(request("/api/admin/export/secrets.csv", { adminToken: t }), params({ kind: "secrets.csv" }));
    expect(unknown.status).toBe(404);
  });

  it("errors never leak internals", async () => {
    const res = await signupRoute(
      request("/api/auth/signup", { raw: "{not json" }),
      undefined as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_JSON");
  });
});

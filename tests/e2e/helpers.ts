import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { count, eq } from "drizzle-orm";
import { createDb } from "../../src/server/db";
import { ballotChoices, ballots, elections, voterParticipation, voters } from "../../src/server/db/schema";
import { assertDisposableDatabase } from "../../scripts/lib/db-safety";
import { seedAdmin, seedElection, truncateAll } from "../../scripts/lib/fixtures";

export const ADMIN = { username: "admin", password: "test-admin-password" };

let handle: ReturnType<typeof createDb> | undefined;
/** Direct access to the E2E database, used for fixtures and for verifying real DB state. */
export function e2eDb() {
  handle ??= createDb(assertDisposableDatabase(process.env.E2E_DATABASE_URL), 3);
  return handle.db;
}

/** Fresh database: admin + DRAFT election with 12 candidates and M = 5 (configurable). */
export async function resetDatabase(opts: { candidateCount?: number; maxSelections?: number; election?: boolean } = {}) {
  const db = e2eDb();
  await truncateAll(db);
  await seedAdmin(db, ADMIN);
  if (opts.election === false) return { election: null, candidates: [] };
  return seedElection(db, { candidateCount: opts.candidateCount ?? 12, maxSelections: opts.maxSelections ?? 5 });
}

export async function dbState() {
  const db = e2eDb();
  const [[e], [p], [b], [c], [v]] = await Promise.all([
    db.select({ status: elections.status, maxSelections: elections.maxSelections, name: elections.name }).from(elections),
    db.select({ n: count() }).from(voterParticipation),
    db.select({ n: count() }).from(ballots),
    db.select({ n: count() }).from(ballotChoices),
    db.select({ n: count() }).from(voters),
  ]);
  return { election: e, participation: p.n, ballots: b.n, choices: c.n, voters: v.n };
}

export async function voterHasVoted(registrationNumber: string) {
  const db = e2eDb();
  const [v] = await db.select({ id: voters.id }).from(voters).where(eq(voters.registrationNumberNormalized, registrationNumber.toUpperCase()));
  if (!v) return false;
  const rows = await db.select().from(voterParticipation).where(eq(voterParticipation.voterId, v.id));
  return rows.length === 1;
}

/** Unique-per-test student data (registration numbers differ between projects). */
export function student(testInfo: TestInfo, n = 1) {
  const tag = testInfo.project.name.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
  return {
    fullName: ["Asha Verma", "Bala Krishnan", "Chitra Menon", "Dev Raman"][n - 1] ?? "Extra Student",
    registrationNumber: `E2E${tag}${String(n).padStart(3, "0")}`,
    password: `e2e-password-${n}`,
  };
}

export type Student = ReturnType<typeof student>;

export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `page ${page.url()} overflows horizontally`).toBeLessThanOrEqual(clientWidth);
}

/** Our alert boxes (excludes Next.js's empty route announcer, which also has role=alert). */
export function formAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

export async function signupViaUi(page: Page, s: Student) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(s.fullName);
  await page.getByLabel("College registration number").fill(s.registrationNumber);
  await page.getByLabel("Password", { exact: true }).fill(s.password);
  await page.getByRole("button", { name: "Register" }).tap();
}

export async function loginViaUi(page: Page, s: Pick<Student, "registrationNumber" | "password">) {
  await page.goto("/login");
  await page.getByLabel("College registration number").fill(s.registrationNumber);
  await page.getByLabel("Password", { exact: true }).fill(s.password);
  await page.getByRole("button", { name: "Log in" }).tap();
}

export async function logoutViaUi(page: Page) {
  await page.getByRole("button", { name: "Log out" }).tap();
  await expect(page).toHaveURL(/\/(login|admin\/login)$/);
}

export async function adminLoginViaUi(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Runs a lifecycle transition through the admin UI (with confirmation dialog). */
export async function adminTransition(page: Page, label: "Start voting" | "Stop voting" | "Finalize election", expectedStatus: string) {
  await page.goto("/admin");
  await page.getByTestId("transition-button").tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: label }).tap();
  await expect(page.getByTestId("election-status")).toHaveAttribute("data-status", expectedStatus);
}

/**
 * A second, fully isolated browser context (separate cookies) with the same
 * phone profile as the current project, e.g. for the administrator or for a
 * student's "other device".
 */
export async function newPhoneContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const u = testInfo.project.use;
  return browser.newContext({
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    baseURL: u.baseURL,
  });
}

export async function selectCandidates(page: Page, n: number) {
  const options = page.getByTestId("candidate-option");
  for (let i = 0; i < n; i++) await options.nth(i).tap();
}

export async function selectedNames(page: Page) {
  const options = page.getByTestId("candidate-option");
  const names: string[] = [];
  for (const el of await options.all()) {
    if (await el.isChecked()) names.push((await el.getAttribute("data-candidate-name"))!);
  }
  return names;
}

/** Simulates a repeat submission straight to the API using the page's cookies. */
export async function rawBallotSubmit(page: Page, candidateIds: number[]) {
  return page.request.post("/api/student/ballot", {
    data: { candidateIds, submissionKey: crypto.randomUUID() },
  });
}

/** Issues a recovery link through the admin UI and returns its URL. */
export async function adminIssueRecovery(page: Page, registrationNumber: string) {
  await page.goto("/admin/students");
  await page.getByLabel("Search by name or registration number").fill(registrationNumber);
  const row = page.locator(`[data-testid="student-row"][data-registration="${registrationNumber}"]`);
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId("student-row")).toHaveCount(1);
  await row.getByRole("button", { name: "Reset password" }).tap();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create recovery link" }).tap();
  const url = (await page.getByTestId("recovery-url").textContent())!.trim();
  expect(url).toMatch(/\/reset-password#[A-Za-z0-9_-]{43}$/);
  return url;
}

export async function resetPasswordViaLink(page: Page, url: string, newPassword: string) {
  await page.goto(url);
  await expect(page.getByText("Recovery link detected")).toBeVisible();
  // The token is removed from the address bar after it's read.
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Set new password" }).tap();
}

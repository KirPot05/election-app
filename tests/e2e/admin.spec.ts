import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { parseCsv } from "../../src/lib/csv";
import { submitBallot } from "../../src/server/services/ballot";
import { signup } from "../../src/server/services/voters";
import {
  ADMIN,
  adminLoginViaUi,
  adminTransition,
  dbState,
  e2eDb,
  expectNoHorizontalOverflow,
  formAlert,
  resetDatabase,
  student,
} from "./helpers";

function adminNav(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name, exact: true });
}

async function downloadText(page: Page, testId: string) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).tap()]);
  return readFileSync((await download.path())!, "utf8");
}

test("admin configures, runs, monitors, exports and finalizes the election from a phone", async ({ page }, testInfo) => {
  await resetDatabase({ candidateCount: 0, maxSelections: 1 });
  const db = e2eDb();
  const [s1, s2] = [student(testInfo, 1), student(testInfo, 2)];
  const v1 = await signup(db, s1, { ip: "e2e-1" });
  await signup(db, s2, { ip: "e2e-2" });

  // 1-2. Log in and open the dashboard.
  await adminLoginViaUi(page);
  await expect(page.getByTestId("election-status")).toHaveAttribute("data-status", "DRAFT");
  await expect(page.getByText("Voting can't start yet")).toBeVisible();
  await expect(page.getByTestId("transition-button")).toBeDisabled();
  await expectNoHorizontalOverflow(page);

  // 3. Configure the election.
  await adminNav(page, "Election").tap();
  await page.getByLabel("Election name").fill("Student Council 2026");
  await page.getByLabel("Maximum selections per student (M)").fill("3");
  await page.getByRole("button", { name: "Save settings" }).tap();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 4. Add candidates: two by form, three by CSV import; edit and delete one.
  await adminNav(page, "Candidates").tap();
  for (const name of ["Asha Verma", "Bala Krishnan"]) {
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add candidate" }).tap();
    await expect(page.getByText("Candidate added.")).toBeVisible();
  }
  await page.getByLabel("Candidate CSV file").setInputFiles({
    name: "candidates.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('name,description\n"Chitra Menon","Physics, 2nd year"\nDev Raman,\nTemporary Person,\n'),
  });
  await page.getByRole("button", { name: "Import candidates" }).tap();
  await expect(page.getByText("Imported 3 candidate(s).")).toBeVisible();
  await expect(page.getByTestId("candidate-row")).toHaveCount(5);
  await page.getByRole("button", { name: "Edit Dev Raman" }).tap();
  await page.getByLabel("Description", { exact: true }).fill("Economics, 3rd year");
  await page.getByRole("button", { name: "Save" }).tap();
  await expect(page.getByText("Economics, 3rd year")).toBeVisible();
  await page.getByRole("button", { name: "Delete Temporary Person" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).tap();
  await expect(page.getByTestId("candidate-row")).toHaveCount(4);
  await expectNoHorizontalOverflow(page);

  // 5. View registered students.
  await adminNav(page, "Students").tap();
  await expect(page.getByTestId("student-row")).toHaveCount(2);

  // 6-7. Start voting -> OPEN.
  await adminTransition(page, "Start voting", "OPEN");
  expect((await dbState()).election).toMatchObject({ status: "OPEN", maxSelections: 3, name: "Student Council 2026" });

  // 8-9. Live participation and candidate totals update by polling, without reload.
  await expect(page.getByTestId("stat-voted")).toHaveText("0");
  const candidates = await db.query.candidates.findMany();
  const asha = candidates.find((c) => c.name === "Asha Verma")!;
  const dev = candidates.find((c) => c.name === "Dev Raman")!;
  await submitBallot(db, v1.voterId, { candidateIds: [asha.id, dev.id], submissionKey: crypto.randomUUID() });
  await expect(page.getByTestId("stat-voted")).toHaveText("1", { timeout: 15_000 });
  await expect(page.getByTestId("stat-turnout")).toHaveText("50%");
  await expect(page.locator('[data-testid="candidate-total"][data-name="Asha Verma"]')).toHaveAttribute("data-votes", "1");
  await expect(page.locator('[data-testid="candidate-total"][data-name="Bala Krishnan"]')).toHaveAttribute("data-votes", "0");
  await expect(page.getByTestId("candidate-total").first()).toHaveAttribute("data-votes", "1"); // sorted by votes

  // 10. Search for a student by name and by registration number; filter by status.
  await adminNav(page, "Students").tap();
  await page.getByLabel("Search by name or registration number").fill("bala");
  await expect(page.getByTestId("student-row")).toHaveCount(1);
  await expect(page.getByTestId("student-row")).toContainText(s2.registrationNumber);
  await page.getByLabel("Search by name or registration number").fill(s1.registrationNumber.toLowerCase());
  await expect(page.getByTestId("student-row")).toHaveCount(1);
  await expect(page.getByTestId("student-row").getByTestId("voted-badge")).toBeVisible();
  await page.getByLabel("Search by name or registration number").fill("");
  await page.getByRole("button", { name: "Not voted" }).tap();
  await expect(page.getByTestId("student-row")).toHaveCount(1);
  await expect(page.getByTestId("student-row")).toContainText(s2.fullName);
  await page.getByRole("button", { name: "All" }).tap();
  await expectNoHorizontalOverflow(page);

  // 11. Initiate password recovery.
  const row = page.locator(`[data-testid="student-row"][data-registration="${s2.registrationNumber}"]`);
  await row.getByRole("button", { name: "Reset password" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "Create recovery link" }).tap();
  await expect(page.getByTestId("recovery-url")).toContainText("/reset-password#");
  await expectNoHorizontalOverflow(page);

  // 12. Stop voting -> CLOSED.
  await adminTransition(page, "Stop voting", "CLOSED");

  // 13. Export results and participation.
  const results = parseCsv(await downloadText(page, "export-results"));
  expect(results.find((r) => r[0] === "Students who voted")?.[1]).toBe("1");
  const rows = results.slice(results.findIndex((r) => r[0] === "Candidate") + 1);
  expect(Object.fromEntries(rows)).toEqual({ "Asha Verma": "1", "Dev Raman": "1", "Bala Krishnan": "0", "Chitra Menon": "0" });
  const participation = parseCsv(await downloadText(page, "export-participation"));
  expect(participation).toContainEqual([s1.fullName, s1.registrationNumber, "Yes", "Yes"]);
  expect(participation).toContainEqual([s2.fullName, s2.registrationNumber, "Yes", "No"]);

  // 14. Finalize -> FINALIZED and locked.
  await adminTransition(page, "Finalize election", "FINALIZED");
  await expect(page.getByText("permanently locked")).toBeVisible();
  await expect(page.getByTestId("transition-button")).toHaveCount(0);

  // 15. Log out; the admin area is no longer reachable.
  await page.getByRole("button", { name: "Log out" }).tap();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("admin area and APIs reject unauthenticated access and wrong passwords", async ({ page }) => {
  await resetDatabase();
  for (const path of ["/admin", "/admin/students", "/admin/candidates", "/admin/election", "/admin/audit"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
  expect((await page.request.get("/api/admin/dashboard")).status()).toBe(401);
  expect((await page.request.get("/api/admin/export/results.csv")).status()).toBe(401);
  const transition = await page.request.post("/api/admin/election/transition", { data: { to: "OPEN", confirm: true } });
  expect(transition.status()).toBe(401);
  expect((await dbState()).election.status).toBe("DRAFT");

  await page.goto("/admin/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).tap();
  await expect(formAlert(page)).toHaveText("Incorrect username or password.");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

import { expect, test } from "@playwright/test";
import {
  adminIssueRecovery,
  adminLoginViaUi,
  adminTransition,
  dbState,
  formAlert,
  loginViaUi,
  newPhoneContext,
  rawBallotSubmit,
  resetDatabase,
  resetPasswordViaLink,
  selectCandidates,
  signupViaUi,
  student,
  voterHasVoted,
} from "./helpers";

test("admin-assisted recovery: old session revoked, single-use link, voted status preserved", async ({ page, browser }, testInfo) => {
  const { candidates } = await resetDatabase();
  const s = student(testInfo);
  const newPassword = "brand-new-password-1";

  // 1-2. Create the student and log them in.
  await signupViaUi(page, s);
  await expect(page.getByTestId("screen-waiting")).toBeVisible();

  // The student votes first, so we can verify recovery never touches the ballot.
  const adminContext = await newPhoneContext(browser, testInfo);
  const admin = await adminContext.newPage();
  await adminLoginViaUi(admin);
  await adminTransition(admin, "Start voting", "OPEN");
  await page.reload();
  await selectCandidates(page, 2);
  await page.getByTestId("review-vote").tap();
  await page.getByTestId("confirm-vote").tap();
  await expect(page.getByTestId("screen-voted")).toBeVisible();
  const before = await dbState();
  expect(before).toMatchObject({ participation: 1, ballots: 1, choices: 2 });

  // 3, 5. Admin initiates recovery and obtains a single-use link.
  const url = await adminIssueRecovery(admin, s.registrationNumber);

  // 4. Policy: issuing recovery signs the student out everywhere.
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);

  // 6-7. The student opens the link and sets a new password.
  await resetPasswordViaLink(page, url, newPassword);
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByText("Password updated")).toBeVisible();
  await expect(page.getByLabel("College registration number")).toHaveValue(s.registrationNumber);

  // 8. Old password is rejected.
  await loginViaUi(page, s);
  await expect(formAlert(page)).toHaveText("Incorrect registration number or password.");

  // 9, 11, 12. New password works; the ballot is still recorded and cannot be repeated.
  await loginViaUi(page, { registrationNumber: s.registrationNumber, password: newPassword });
  await expect(page.getByTestId("screen-voted")).toBeVisible();
  expect(await dbState()).toMatchObject({ participation: before.participation, ballots: before.ballots, choices: before.choices });
  expect(await voterHasVoted(s.registrationNumber)).toBe(true);
  const again = await rawBallotSubmit(page, [candidates[9].id]);
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("ALREADY_VOTED");

  // 10. The link cannot be reused.
  const thief = await newPhoneContext(browser, testInfo);
  const other = await thief.newPage();
  await resetPasswordViaLink(other, url, "attacker-password-1");
  await expect(formAlert(other)).toContainText("invalid, expired or already used");

  await adminContext.close();
  await thief.close();
});

test("student changes their own password; other devices are signed out", async ({ page, browser }, testInfo) => {
  await resetDatabase();
  const s = student(testInfo);
  await signupViaUi(page, s);
  await expect(page.getByTestId("screen-waiting")).toBeVisible();

  const otherContext = await newPhoneContext(browser, testInfo);
  const other = await otherContext.newPage();
  await loginViaUi(other, s);
  await expect(other.getByTestId("screen-waiting")).toBeVisible();

  await page.getByRole("link", { name: "Change password" }).tap();
  await page.getByLabel("Current password", { exact: true }).fill(s.password);
  await page.getByLabel("New password", { exact: true }).fill("changed-password-1");
  await page.getByLabel("Confirm new password", { exact: true }).fill("changed-password-2");
  await page.getByRole("button", { name: "Change password" }).tap();
  await expect(page.getByText("The new passwords do not match.")).toBeVisible();
  await page.getByLabel("Confirm new password", { exact: true }).fill("changed-password-1");
  await page.getByRole("button", { name: "Change password" }).tap();
  await expect(page.getByText("Password changed.")).toBeVisible();

  // This device stays signed in (rotated session); the other device is signed out.
  await page.goto("/dashboard");
  await expect(page.getByTestId("screen-waiting")).toBeVisible();
  await other.reload();
  await expect(other).toHaveURL(/\/login$/);
  await loginViaUi(other, { registrationNumber: s.registrationNumber, password: "changed-password-1" });
  await expect(other.getByTestId("screen-waiting")).toBeVisible();
  await otherContext.close();
});

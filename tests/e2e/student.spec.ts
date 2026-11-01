import { expect, test } from "@playwright/test";
import {
  adminLoginViaUi,
  adminTransition,
  dbState,
  expectNoHorizontalOverflow,
  formAlert,
  loginViaUi,
  logoutViaUi,
  newPhoneContext,
  rawBallotSubmit,
  resetDatabase,
  selectCandidates,
  selectedNames,
  signupViaUi,
  student,
  voterHasVoted,
} from "./helpers";

test("student journey: register, wait, log in again, vote once, stay voted on another device", async ({ page, browser }, testInfo) => {
  const { candidates } = await resetDatabase();
  const s = student(testInfo);

  // 1-2. Open signup and submit valid details.
  await signupViaUi(page, s);

  // 3-5. Registration succeeds, the student is logged in and sees the waiting page.
  await expect(page).toHaveURL(/\/dashboard\?welcome=1$/);
  const waiting = page.getByTestId("screen-waiting");
  await expect(waiting).toBeVisible();
  await expect(waiting.getByText("Registration successful!")).toBeVisible();
  await expect(waiting.getByText("The election has not started yet.")).toBeVisible();
  await expect(page.getByTestId("student-registration")).toHaveText(s.registrationNumber);
  await expect(page.getByTestId("election-status")).toHaveAttribute("data-status", "DRAFT");
  await expectNoHorizontalOverflow(page);
  expect((await dbState()).voters).toBe(1);

  // 6. Refresh preserves the session (returning-student wording, no repeated success message).
  await page.goto("/dashboard");
  await page.reload();
  await expect(waiting).toBeVisible();
  await expect(waiting.getByText("You're registered")).toBeVisible();
  await expect(waiting.getByText("Registration successful!")).toHaveCount(0);

  // 7. Log out: the session is gone server-side.
  await logoutViaUi(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  // 8-9. Log in with registration number (different case) and password -> waiting page.
  await loginViaUi(page, { registrationNumber: s.registrationNumber.toLowerCase(), password: s.password });
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(waiting).toBeVisible();

  // 10. The administrator activates the election (separate phone context).
  const adminContext = await newPhoneContext(browser, testInfo);
  const admin = await adminContext.newPage();
  await adminLoginViaUi(admin);
  await adminTransition(admin, "Start voting", "OPEN");

  // 11-12. The student refreshes and the ballot appears (no re-login needed).
  await page.reload();
  await expect(page.getByTestId("ballot")).toBeVisible();
  await expect(page.getByText("up to 5")).toBeVisible();

  // 13-15. Selecting candidates updates the count; selecting more than M is prevented.
  const countLabel = page.getByTestId("selection-count");
  const reviewButton = page.getByTestId("review-vote");
  await expect(countLabel).toContainText("0 of 5");
  await expect(reviewButton).toBeDisabled();
  await selectCandidates(page, 3);
  await expect(countLabel).toContainText("3 of 5");
  const options = page.getByTestId("candidate-option");
  await options.nth(0).tap(); // deselect
  await expect(countLabel).toContainText("2 of 5");
  await options.nth(0).tap(); // reselect
  await options.nth(3).tap();
  await options.nth(4).tap();
  await expect(countLabel).toContainText("5 of 5");
  // A 6th tap is refused (and explained). The row is aria-disabled, which
  // Playwright treats as non-actionable, but a real finger can still tap it.
  await options.nth(5).scrollIntoViewIfNeeded();
  await options.nth(5).tap({ force: true });
  await expect(options.nth(5)).not.toBeChecked();
  await expect(countLabel).toContainText("5 of 5");
  await expect(page.getByTestId("limit-notice")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const chosen = await selectedNames(page);
  expect(chosen).toHaveLength(5);

  // 16. Review, go back to edit, review again.
  await reviewButton.tap();
  const review = page.getByTestId("ballot-review");
  await expect(review.getByText("Your vote is final.")).toBeVisible();
  await expect(page.getByTestId("review-list").locator("li")).toHaveText(chosen);
  await review.getByRole("button", { name: "Back to edit" }).tap();
  await expect(countLabel).toContainText("5 of 5");
  await reviewButton.tap();

  // 17-18. Confirm; the success state appears and the DB holds exactly one ballot.
  await page.getByTestId("confirm-vote").tap();
  await expect(page.getByTestId("screen-voted")).toBeVisible();
  await expect(page.getByText("Vote submitted successfully")).toBeVisible();
  expect(await dbState()).toMatchObject({ participation: 1, ballots: 1, choices: 5 });
  expect(await voterHasVoted(s.registrationNumber)).toBe(true);

  // 19. Refresh keeps the voted state.
  await page.goto("/dashboard");
  await page.reload();
  await expect(page.getByTestId("screen-voted")).toBeVisible();
  await expect(page.getByText("You have already voted")).toBeVisible();
  await expect(page.getByTestId("ballot")).toHaveCount(0);

  // 20. A repeated submission (direct API call with the same session) is rejected.
  const again = await rawBallotSubmit(page, [candidates[11].id]);
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("ALREADY_VOTED");
  expect(await dbState()).toMatchObject({ participation: 1, ballots: 1, choices: 5 });

  // 21-22. Logging in from a different device keeps the already-voted state.
  const otherDevice = await newPhoneContext(browser, testInfo);
  const phone2 = await otherDevice.newPage();
  await loginViaUi(phone2, s);
  await expect(phone2.getByTestId("screen-voted")).toBeVisible();
  const fromPhone2 = await rawBallotSubmit(phone2, [candidates[11].id]);
  expect(fromPhone2.status()).toBe(409);

  await adminContext.close();
  await otherDevice.close();
});

test("signup validation, duplicate registration and generic login errors", async ({ page }, testInfo) => {
  await resetDatabase();
  const s = student(testInfo);

  await page.goto("/signup");
  await page.getByRole("button", { name: "Register" }).tap();
  await expect(page.getByText("Full name is required.")).toBeVisible();
  await expect(page.getByText(/Password must be at least 8/)).toBeVisible();
  expect((await dbState()).voters).toBe(0);

  await signupViaUi(page, s);
  await expect(page.getByTestId("screen-waiting")).toBeVisible();
  await logoutViaUi(page);

  // Same registration number with different spacing/case is a duplicate.
  await signupViaUi(page, { ...s, fullName: "Someone Else", registrationNumber: ` ${s.registrationNumber.toLowerCase()} ` });
  await expect(formAlert(page)).toContainText("already exists");
  expect((await dbState()).voters).toBe(1);

  await loginViaUi(page, { registrationNumber: s.registrationNumber, password: "wrong-password" });
  await expect(formAlert(page)).toHaveText("Incorrect registration number or password.");
  await loginViaUi(page, { registrationNumber: "NOBODY999", password: "wrong-password" });
  await expect(formAlert(page)).toHaveText("Incorrect registration number or password.");
});

test("registration is closed once voting has started; the waiting page picks up the change automatically", async ({ page, browser }, testInfo) => {
  await resetDatabase();
  const s = student(testInfo);
  await signupViaUi(page, s);
  await expect(page.getByTestId("screen-waiting")).toBeVisible();

  const adminContext = await newPhoneContext(browser, testInfo);
  const admin = await adminContext.newPage();
  await adminLoginViaUi(admin);
  await adminTransition(admin, "Start voting", "OPEN");

  // Without any manual refresh, the waiting page's polling shows the ballot.
  await expect(page.getByTestId("ballot")).toBeVisible({ timeout: 20_000 });

  const visitor = await newPhoneContext(browser, testInfo);
  const late = await visitor.newPage();
  await late.goto("/signup");
  await expect(late.getByTestId("registration-closed")).toBeVisible();
  const res = await late.request.post("/api/auth/signup", {
    data: { fullName: "Late Student", registrationNumber: "LATE0001", password: "password-123" },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe("REGISTRATION_CLOSED");
  expect((await dbState()).voters).toBe(1);
  await adminContext.close();
  await visitor.close();
});

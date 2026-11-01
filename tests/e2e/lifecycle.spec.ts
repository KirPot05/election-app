import { expect, test } from "@playwright/test";
import { tallyFromDatabase } from "../../src/server/services/results";
import { signup } from "../../src/server/services/voters";
import {
  adminIssueRecovery,
  adminLoginViaUi,
  adminTransition,
  dbState,
  e2eDb,
  expectNoHorizontalOverflow,
  loginViaUi,
  logoutViaUi,
  newPhoneContext,
  rawBallotSubmit,
  resetDatabase,
  resetPasswordViaLink,
  selectCandidates,
  selectedNames,
  signupViaUi,
  student,
  voterHasVoted,
} from "./helpers";

test("complete election lifecycle on mobile", async ({ page: studentPage, browser }, testInfo) => {
  // 1-4. Fresh test database; election in DRAFT with 12 candidates and M = 5.
  const { election, candidates } = await resetDatabase({ candidateCount: 12, maxSelections: 5 });
  expect(candidates).toHaveLength(12);
  expect((await dbState()).election).toMatchObject({ status: "DRAFT", maxSelections: 5 });
  const s = student(testInfo, 1);
  const other = student(testInfo, 2);
  await signup(e2eDb(), other, { ip: "e2e-other" }); // a second registered student (step 33)

  // 5-7. Mobile student context registers.
  await signupViaUi(studentPage, s);
  await expect(studentPage.getByText("Registration successful!")).toBeVisible();

  // 8. Waiting screen.
  await expect(studentPage.getByTestId("screen-waiting")).toBeVisible();
  await expect(studentPage.getByTestId("election-status")).toHaveAttribute("data-status", "DRAFT");

  // 9. Refresh keeps the session.
  await studentPage.reload();
  await expect(studentPage.getByTestId("screen-waiting")).toBeVisible();
  await expect(studentPage.getByTestId("student-name")).toHaveText(s.fullName);

  // 10-12. Separate administrator context logs in and starts the election.
  const adminContext = await newPhoneContext(browser, testInfo);
  const admin = await adminContext.newPage();
  await adminLoginViaUi(admin);
  await expect(admin.getByTestId("stat-registered")).toHaveText("2");
  await adminTransition(admin, "Start voting", "OPEN");
  await expect(admin.getByTestId("stat-voted")).toHaveText("0");

  // 13-15. Student refreshes; the voting interface is available.
  await studentPage.reload();
  await expect(studentPage.getByTestId("ballot")).toBeVisible();
  await expect(studentPage.getByTestId("candidate-option")).toHaveCount(12);
  await expectNoHorizontalOverflow(studentPage);

  // 16. Select five distinct candidates.
  await selectCandidates(studentPage, 5);
  await expect(studentPage.getByTestId("selection-count")).toContainText("5 of 5");
  const chosen = await selectedNames(studentPage);
  expect(new Set(chosen).size).toBe(5);

  // 17. Review.
  await studentPage.getByTestId("review-vote").tap();
  await expect(studentPage.getByTestId("review-list").locator("li")).toHaveText(chosen);

  // 18-19. Submit; success confirmation.
  await studentPage.getByTestId("confirm-vote").tap();
  await expect(studentPage.getByTestId("screen-voted")).toBeVisible();
  await expect(studentPage.getByText("Vote submitted successfully")).toBeVisible();

  // 20-21. Another submission is rejected and nothing changes.
  const repeat = await rawBallotSubmit(studentPage, [candidates[11].id]);
  expect(repeat.status()).toBe(409);
  expect((await repeat.json()).error.code).toBe("ALREADY_VOTED");
  expect(await dbState()).toMatchObject({ participation: 1, ballots: 1, choices: 5 });

  // 22-24. Admin dashboard: turnout +1, candidate totals match the selections.
  await admin.goto("/admin");
  await expect(admin.getByTestId("stat-voted")).toHaveText("1");
  await expect(admin.getByTestId("stat-not-voted")).toHaveText("1");
  await expect(admin.getByTestId("stat-turnout")).toHaveText("50%");
  for (const c of candidates) {
    await expect(admin.locator(`[data-testid="candidate-total"][data-name="${c.name}"]`)).toHaveAttribute(
      "data-votes",
      chosen.includes(c.name) ? "1" : "0",
    );
  }

  // 25-27. Student logs out and back in: already-voted state.
  await logoutViaUi(studentPage);
  await loginViaUi(studentPage, s);
  await expect(studentPage.getByTestId("screen-voted")).toBeVisible();
  await expect(studentPage.getByText("You have already voted")).toBeVisible();

  // 28-29. Admin initiates recovery; student resets the password.
  const url = await adminIssueRecovery(admin, s.registrationNumber);
  await resetPasswordViaLink(studentPage, url, "lifecycle-new-password");
  await expect(studentPage).toHaveURL(/\/login\?reset=1/);

  // 30-31. Login with the new password; voting status unchanged.
  await loginViaUi(studentPage, { registrationNumber: s.registrationNumber, password: "lifecycle-new-password" });
  await expect(studentPage.getByTestId("screen-voted")).toBeVisible();
  expect(await voterHasVoted(s.registrationNumber)).toBe(true);
  expect(await dbState()).toMatchObject({ participation: 1, ballots: 1, choices: 5 });

  // 32. Admin closes the election.
  await adminTransition(admin, "Stop voting", "CLOSED");

  // 33-34. Another registered student attempts to vote after closure: rejected.
  const otherContext = await newPhoneContext(browser, testInfo);
  const otherPage = await otherContext.newPage();
  await loginViaUi(otherPage, other);
  await expect(otherPage.getByTestId("screen-closed")).toBeVisible();
  await expect(otherPage.getByTestId("participation-note")).toHaveText("You did not vote in this election.");
  const late = await rawBallotSubmit(otherPage, [candidates[0].id]);
  expect(late.status()).toBe(409);
  expect((await late.json()).error.code).toBe("ELECTION_CLOSED");
  expect(await voterHasVoted(other.registrationNumber)).toBe(false);

  // 35. Finalize.
  await adminTransition(admin, "Finalize election", "FINALIZED");
  await studentPage.reload();
  await expect(studentPage.getByTestId("screen-finalized")).toBeVisible();

  // 36. Results are consistent: UI, raw DB tally and exported CSV agree.
  const tally = await tallyFromDatabase(e2eDb(), election!.id);
  const byName = new Map(candidates.map((c) => [c.name, tally.get(c.id) ?? 0]));
  for (const name of chosen) expect(byName.get(name)).toBe(1);
  expect([...byName.values()].reduce((a, b) => a + b, 0)).toBe(5);
  const csv = await (await admin.request.get("/api/admin/export/results.csv")).text();
  for (const [name, votes] of byName) expect(csv).toContain(`${name},${votes}`);
  expect(csv).toContain("Counts consistent,Yes");
  await expect(admin.getByTestId("stat-ballots")).toHaveText("1");

  // 37. Configuration is locked (UI and API).
  await admin.goto("/admin/election");
  await expect(admin.getByText("Settings can only be changed before voting starts.")).toBeVisible();
  await expect(admin.getByLabel("Maximum selections per student (M)")).toBeDisabled();
  await admin.goto("/admin/candidates");
  await expect(admin.getByText("Candidates can only be changed before voting starts.")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Add candidate" })).toHaveCount(0);
  const patch = await admin.request.patch("/api/admin/election", { data: { name: "Changed", maxSelections: 1 } });
  expect(patch.status()).toBe(409);
  const add = await admin.request.post("/api/admin/candidates", { data: { name: "Late Candidate" } });
  expect(add.status()).toBe(409);
  const reopen = await admin.request.post("/api/admin/election/transition", { data: { to: "OPEN", confirm: true } });
  expect(reopen.status()).toBe(409);
  expect((await dbState()).election).toMatchObject({ status: "FINALIZED", maxSelections: 5 });

  await adminContext.close();
  await otherContext.close();
});

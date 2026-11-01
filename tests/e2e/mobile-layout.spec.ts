import { expect, test, type Page } from "@playwright/test";
import { signup } from "../../src/server/services/voters";
import { adminLoginViaUi, adminTransition, e2eDb, expectNoHorizontalOverflow, loginViaUi, newPhoneContext, resetDatabase, student } from "./helpers";

/** Every visible button / checkbox label / nav link is at least 44 x 44 CSS px. */
async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const els = document.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="submit"], label:has(> input[type="checkbox"]), label:has(> input[type="radio"]), nav a, input[type="text"], input[type="password"], input[type="search"], input[type="number"]',
    );
    const out: string[] = [];
    for (const el of els) {
      if (el.closest("dialog:not([open])")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) out.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  expect(small, `undersized touch targets on ${page.url()}`).toEqual([]);
}

async function check(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
}

test("public and student pages fit the screen with comfortable touch targets", async ({ page }, testInfo) => {
  await resetDatabase();
  for (const path of ["/", "/signup", "/login", "/reset-password", "/admin/login"]) await check(page, path);
  const s = student(testInfo);
  await signup(e2eDb(), s, { ip: "layout" });
  await loginViaUi(page, s);
  await expect(page.getByTestId("screen-waiting")).toBeVisible();
  await check(page, "/dashboard");
  await check(page, "/account");
});

test("ballot and admin pages fit the screen with comfortable touch targets", async ({ page, browser }, testInfo) => {
  await resetDatabase();
  const s = student(testInfo);
  await signup(e2eDb(), { ...s, fullName: "Venkata Subramanya Lakshminarasimha Raghavendra" }, { ip: "layout" });

  await adminLoginViaUi(page);
  for (const path of ["/admin", "/admin/election", "/admin/candidates", "/admin/students", "/admin/audit"]) await check(page, path);
  await adminTransition(page, "Start voting", "OPEN");
  await check(page, "/admin");

  const studentContext = await newPhoneContext(browser, testInfo);
  const phone = await studentContext.newPage();
  await loginViaUi(phone, s);
  await expect(phone.getByTestId("ballot")).toBeVisible();
  await expectNoHorizontalOverflow(phone);
  await expectTouchTargets(phone);
  await studentContext.close();
});

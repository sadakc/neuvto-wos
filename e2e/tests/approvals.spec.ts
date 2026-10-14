import { expect, test, type Browser } from "@playwright/test";
import { addDays, tuesdayInWeeks } from "../support/dates";
import { sessionFile } from "../support/people";

// A manager decides leave. Ravi (who reports to Mark) asks twice; Mark rejects
// one, which needs a reason and a note, and approves the other. Ravi then sees
// both decisions. Somebody who is not his approver sees neither request.

test.describe.configure({ mode: "serial" });

const first = tuesdayInWeeks(8);
const second = tuesdayInWeeks(10);

async function raviAsks(browser: Browser, day: string) {
  const context = await browser.newContext({ storageState: sessionFile("colleague") });
  const page = await context.newPage();
  await page.goto("/app/leave/apply");
  await page.getByLabel("Leave type").selectOption({ label: "Sick" });
  await page.getByLabel("First day").fill(day);
  await page.getByLabel("Last day").fill(addDays(day, 1));
  await page.getByTestId("submit-leave").click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
  await context.close();
}

test.beforeAll(async ({ browser }) => {
  await raviAsks(browser, first);
  await raviAsks(browser, second);
});

test.describe("as the manager", () => {
  test.use({ storageState: sessionFile("manager") });

  test("a rejection needs a reason and a real note", async ({ page }) => {
    await page.goto("/app/approvals");
    const items = page.getByTestId("approval-item").filter({ hasText: "Ravi" });
    await expect(items).toHaveCount(2);
    const item = items.first();
    await item.getByTestId("reject").click();
    const confirm = item.getByTestId("confirm-reject");
    await expect(confirm).toBeDisabled();

    await item
      .getByTestId("reject-reason")
      .selectOption({ label: "Needed at work on those dates" });
    await expect(confirm).toBeDisabled();
    await item.getByTestId("reject-note").fill("ok");
    await expect(confirm).toBeDisabled();
    await item.getByTestId("reject-note").fill("Audit week, everyone is needed on site.");
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(items).toHaveCount(1);
  });

  test("approving takes one click and clears it from the queue", async ({ page }) => {
    await page.goto("/app/approvals");
    const items = page.getByTestId("approval-item").filter({ hasText: "Ravi" });
    await expect(items).toHaveCount(1);
    await items.first().getByTestId("approve").click();
    await expect(items).toHaveCount(0);
  });
});

test.describe("as Ravi", () => {
  test.use({ storageState: sessionFile("colleague") });

  test("both decisions reach him", async ({ page }) => {
    await page.goto("/app/leave");
    const rows = page.getByRole("button", { expanded: false }).filter({ hasText: "Sick" });
    const declined = rows.filter({ hasText: "Declined" });
    await expect(declined).toHaveCount(1);
    await expect(rows.filter({ hasText: "Approved" })).toHaveCount(1);
    // Opening the declined one says why, in the manager's words.
    await declined.click();
    await expect(page.getByTestId("request-detail")).toContainText(
      /Audit week, everyone is needed on site|Needed at work on those dates/,
    );
  });
});

test.describe("as a colleague who approves nothing", () => {
  test.use({ storageState: sessionFile("employee") });

  test("sees none of Ravi's requests", async ({ page }) => {
    await page.goto("/app/approvals");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByTestId("approval-item").filter({ hasText: "Ravi" })).toHaveCount(0);
  });
});

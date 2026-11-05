import { expect, test } from "@playwright/test";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

// The bell (D111): a person changing their own record tells the Employee
// Admin, who opens the notice and lands on that person's card.

test.describe.configure({ mode: "serial" });

test.describe("the person", () => {
  test.use({ storageState: sessionFile("employee") });

  test("changes their own alternate mobile", async ({ page }) => {
    sql(`delete from public.notifications where event_key = 'employee.changed_own_record'`);
    await page.goto("/app/employee");
    await page.getByTestId("edit-contact").click();
    const editor = page.getByTestId("editor-contact");
    await editor.getByLabel("Mobile", { exact: true }).fill("9845012345");
    await editor.getByLabel("Alternate mobile", { exact: true }).fill("9845054321");
    await page.getByTestId("save-contact").click();
    await expect(editor).toHaveCount(0);
  });
});

test.describe("the Employee Admin", () => {
  test.use({ storageState: sessionFile("hr") });

  test("is told, and the notice opens the person's card", async ({ page }) => {
    await page.goto("/app");
    const bell = page.getByTestId("bell");
    await expect(page.getByTestId("bell-count")).toBeVisible();
    await bell.click();
    const notice = page.getByTestId("notice").filter({ hasText: "Priya Employee changed their" });
    await expect(notice).toHaveAttribute("data-unread", "true");
    await notice.click();
    await page.waitForURL(/directory\/person\?id=/);
    await expect(page.getByRole("heading", { name: "Priya Employee" })).toBeVisible();
  });
});

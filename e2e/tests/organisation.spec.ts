import { expect, test } from "@playwright/test";
import { sessionFile } from "../support/people";

// Sada, 14 Oct 2026 (D108): Organisation holds the views of the whole company.
// Everybody sees the company org chart there; the directory and People are the
// admins'. The Employee Card keeps the person's own line. Approval rules and
// Reports are Leave's. People no longer invites anybody.

test.describe("an employee", () => {
  test.use({ storageState: sessionFile("employee") });

  test("finds the whole company's chart under Organisation, and no directory", async ({ page }) => {
    await page.goto("/app");
    await page.getByTestId("rail-organisation").click();
    await expect(page.getByTestId("tab-/app/employee/org-chart")).toBeVisible();
    await expect(page.getByTestId("tab-/app/employee/directory")).toHaveCount(0);
    await expect(page.getByTestId("tab-people")).toHaveCount(0);
    await page.goto("/app/employee/org-chart");
    await expect(page.getByTestId("org-you")).toContainText("Priya Employee");
    // The top of the company is drawn, not only Priya's manager's team.
    await expect(page.getByTestId("org-node").first()).toBeVisible();
  });

  test("sees only their own line on the Employee Card", async ({ page }) => {
    await page.goto("/app/employee/my-org-chart");
    await expect(page.getByTestId("line-you")).toContainText("Priya Employee");
    await expect(page.getByTestId("line-node").filter({ hasText: "Mark Manager" })).toBeVisible();
    // Ravi reports to Mark too: a peer, not in Priya's line.
    await expect(page.getByTestId("my-org-chart")).not.toContainText("Ravi Employee");
  });

  test("is told the directory is the admins', even by typing its address", async ({ page }) => {
    await page.goto("/app/employee/directory");
    await expect(page.getByRole("alert")).toContainText("The directory is for administrators.");
  });
});

test.describe("an admin", () => {
  test.use({ storageState: sessionFile("hr") });

  test("has People, the directory, the org chart and Settings under Organisation", async ({
    page,
  }) => {
    await page.goto("/app/members");
    for (const id of ["people", "/app/employee/directory", "/app/employee/org-chart", "settings"]) {
      await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
    }
    // No invite form: people are invited from their record.
    await expect(page.getByText("Invite somebody")).toHaveCount(0);
    await expect(page.getByTestId("people-how-to-add")).toBeVisible();
  });

  test("opens somebody from the directory to edit them", async ({ page }) => {
    await page.goto("/app/employee/directory");
    await page.getByRole("link", { name: "Priya Employee" }).first().click();
    await page.waitForURL(/directory\/person\?id=/);
    await expect(page.getByTestId("edit-contact")).toBeVisible();
  });

  test("finds Approval rules and Reports in Leave, not in Organisation", async ({ page }) => {
    await page.goto("/app/leave");
    await expect(page.getByTestId("tab-approval-rules")).toBeVisible();
    await expect(page.getByTestId("tab-reports")).toBeVisible();
    await page.goto("/app/members");
    await expect(page.getByTestId("tab-approval-rules")).toHaveCount(0);
    await expect(page.getByTestId("tab-reports")).toHaveCount(0);
  });
});

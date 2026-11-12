import { expect, test } from "@playwright/test";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

// Sada's fourth round (D106).

test.use({ storageState: sessionFile("hr") });
test.describe.configure({ mode: "serial" });

test("designations are edited and put in order, and every list follows", async ({ page }) => {
  await page.goto("/app/employee/config");
  await page.getByTestId("config-units").click();
  for (const [name, grade] of [
    ["Security Guard", "G1"],
    ["Security Supervisor", "G3"],
    ["Site Manager", "G5"],
  ]) {
    await page.getByTestId("designation-name").fill(name);
    await page.getByLabel("Grade", { exact: true }).fill(grade);
    await page.getByTestId("designation-add").click();
    await expect(page.getByTestId("designation-row").filter({ hasText: name })).toBeVisible();
  }
  // Most senior to the top: Site Manager up twice.
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Move Site Manager up" }).click();
    await expect(page.getByTestId("designation-error")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Move Security Supervisor up" }).click();
  await expect(page.getByTestId("designation-row").first()).toContainText("Site Manager");
  await page.getByRole("button", { name: "Edit Security Guard" }).click();
  await page.getByLabel("Name of Security Guard").fill("Guard");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("designation-row").last()).toContainText("Guard");

  // The dropdown on Add Employee reads in that order.
  await page.goto("/app/employee/add");
  await expect
    .poll(async () =>
      (await page.getByTestId("add-designation").locator("option").allTextContents()).filter((o) =>
        /Site Manager|Security Supervisor|Guard/.test(o),
      ),
    )
    .toEqual(["Site Manager (G5)", "Security Supervisor (G3)", "Guard (G1)"]);
});

test("a unit's state is chosen from the list", async ({ page }) => {
  await page.goto("/app/employee/config");
  await page.getByTestId("config-units").click();
  await page.getByTestId("add-unit").click();
  const state = page.getByTestId("unit-state");
  await expect(state.locator("option:checked")).toHaveText("Karnataka");
  await state.selectOption("Goa");
  await page.getByTestId("unit-name").fill("Panaji Gate");
  await page.getByTestId("unit-save").click();
  await expect(page.getByTestId("unit-row").filter({ hasText: "Panaji Gate" })).toContainText(
    "Goa",
  );
});

test("the import page says what a date looks like", async ({ page }) => {
  await page.goto("/app/employee/import");
  await expect(page.getByTestId("import-date-format")).toContainText("DD/MM/YYYY, like 05/08/1990");
});

test("a manager's team folds away and opens again on the org chart", async ({ page }) => {
  await page.goto("/app/employee/org-chart");
  const chart = page.getByTestId("org-chart");
  const fold = chart.getByRole("button", { name: /^Hide .*'s team$/ }).first();
  await expect(fold).toBeVisible();
  const before = await chart.getByTestId("org-node").count();
  await fold.click();
  expect(await chart.getByTestId("org-node").count()).toBeLessThan(before);
  await chart
    .getByRole("button", { name: /^Show .*'s team$/ })
    .first()
    .click();
  expect(await chart.getByTestId("org-node").count()).toBe(before);
  await page.getByTestId("org-fold-all").click();
  await page.getByTestId("org-open-all").click();
  expect(await chart.getByTestId("org-node").count()).toBe(before);
  expect(sql("select 1")).toEqual(["1"]);
});

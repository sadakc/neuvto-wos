import { expect, test, type Page } from "@playwright/test";
import { addDays, tuesdayInWeeks } from "../support/dates";
import { sessionFile } from "../support/people";

// An employee applies for leave: what the form allows, what it refuses, and
// what the server refuses when the form could not have known.

test.use({ storageState: sessionFile("employee") });
test.describe.configure({ mode: "serial" });

async function fill(page: Page, type: string, from: string, to: string) {
  await page.getByLabel("Leave type").selectOption({ label: type });
  await page.getByLabel("First day").fill(from);
  await page.getByLabel("Last day").fill(to);
}

const from = tuesdayInWeeks(6);
const to = addDays(from, 1);

test("Send stays off until a type and both dates are chosen", async ({ page }) => {
  await page.goto("/app/leave/apply");
  const send = page.getByTestId("submit-leave");
  await expect(send).toBeDisabled();
  await page.getByLabel("Leave type").selectOption({ label: "Casual" });
  await expect(send).toBeDisabled();
  await page.getByLabel("First day").fill(from);
  await expect(send).toBeDisabled();
  await page.getByLabel("Last day").fill(to);
  await expect(page.getByTestId("balance-line")).toContainText("2");
  await expect(send).toBeEnabled();
});

test("a past day cannot be chosen", async ({ page }) => {
  await page.goto("/app/leave/apply");
  const min = await page.getByLabel("First day").getAttribute("min");
  expect(min).not.toBeNull();
  expect(min! >= new Date().toISOString().slice(0, 10)).toBe(true);
});

test("asking for more days than the balance holds is stopped before sending", async ({ page }) => {
  await page.goto("/app/leave/apply");
  // Sick leave is 8 days a year; three weeks is far more.
  await fill(page, "Sick", from, addDays(from, 20));
  await expect(page.getByTestId("shortfall")).toBeVisible();
  await expect(page.getByTestId("submit-leave")).toBeDisabled();
});

test("a request is sent, and shows on My Leave as waiting", async ({ page }) => {
  await page.goto("/app/leave/apply");
  await fill(page, "Casual", from, to);
  await page.getByLabel("Reason").fill("Family visit");
  await page.getByTestId("submit-leave").click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
  await page.getByRole("button", { name: "See my leave" }).click();
  await expect(page).toHaveURL(/\/app\/leave$/);
  await expect(page.getByText(/pending|waiting/i).first()).toBeVisible();
});

test("a day already asked for is refused by the server, with a reason", async ({ page }) => {
  await page.goto("/app/leave/apply");
  // One day, inside the request just sent. One day, because the seed leaves
  // Priya a single Casual day after it, and the form would stop two first.
  await fill(page, "Casual", to, to);
  await expect(page.getByTestId("submit-leave")).toBeEnabled();
  await page.getByTestId("submit-leave").click();
  await expect(page.getByTestId("submit-error")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request sent" })).toHaveCount(0);
});

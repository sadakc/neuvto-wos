import { expect, test } from "@playwright/test";
import { addDays, dmy, tuesdayInWeeks } from "../support/dates";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

// The Employee Admin sets up a shift and gives it to somebody; the person and a
// colleague see the result, and neither is offered the controls.

test.describe.configure({ mode: "serial" });

const raviCard = () =>
  `/app/employee/directory/person?id=${
    sql(
      "select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a005'",
    )[0]
  }`;
const today = new Date().toISOString().slice(0, 10);

test.describe("as the Employee Admin", () => {
  test.use({ storageState: sessionFile("hr") });

  test("a shift needs a name, a length and a whole-number break", async ({ page }) => {
    await page.goto("/app/employee/config");
    await page.getByTestId("config-calendars").click();
    await page.getByRole("button", { name: "Add a shift" }).click();
    const form = page.getByTestId("shift-form");
    const save = form.getByRole("button", { name: "Save shift" });

    await form.getByLabel("Starts").fill("09:00");
    await form.getByLabel("Ends").fill("09:00");
    await expect(save).toBeDisabled(); // no name, and no length
    await form.getByLabel("Name").fill("Gate night");
    await expect(save).toBeDisabled(); // still no length
    await form.getByLabel("Ends").fill("07:00");
    await form.getByLabel("Unpaid break (minutes)").fill("half an hour");
    await expect(save).toBeDisabled();
    await form.getByLabel("Unpaid break (minutes)").fill("30");
    await expect(form).toContainText("09:00 to 07:00 next day, 30 min break");
    await expect(save).toBeEnabled();
  });

  test("a night shift is saved and listed", async ({ page }) => {
    await page.goto("/app/employee/config");
    await page.getByTestId("config-calendars").click();
    await page.getByRole("button", { name: "Add a shift" }).click();
    const form = page.getByTestId("shift-form");
    await form.getByLabel("Name").fill("Gate night");
    await form.getByLabel("Starts").fill("20:00");
    await form.getByLabel("Ends").fill("08:00");
    await form.getByLabel("Unpaid break (minutes)").fill("30");
    await form.getByRole("button", { name: "Save shift" }).click();
    const row = page.getByTestId("shift-row").filter({ hasText: "Gate night" });
    await expect(row).toContainText("20:00 to 08:00 next day, 30 min break");
  });

  test("Ravi is given the shift from today, and his card says so", async ({ page }) => {
    await page.goto(raviCard());
    await page.getByRole("tab", { name: "Employment" }).click();
    const panel = page.getByTestId("panel-shift-calendar");
    await expect(panel).toContainText("No shift set");
    await page.getByRole("button", { name: "Change shift" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Shift", { exact: true })
      .selectOption({ label: "Gate night, 20:00 to 08:00 next day, 30 min break" });
    await expect(dialog.getByRole("textbox", { name: "From", exact: true })).toHaveValue(
      dmy(today),
    );
    await dialog.getByLabel("Reason (optional)").fill("Night post at the gate");
    await dialog.getByRole("button", { name: "Save shift" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel).toContainText("Gate night, 20:00 to 08:00 next day, 30 min break");
    await expect(panel).toContainText("Their own shift, since");
    await expect(page.getByTestId("own-shift-history")).toContainText("Night post at the gate");
  });

  test("a change dated before his current one is refused on the date", async ({ page }) => {
    await page.goto(raviCard());
    await page.getByRole("tab", { name: "Employment" }).click();
    await page.getByRole("button", { name: "Change shift" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Shift", { exact: true }).selectOption({ label: "Their unit's shift" });
    await dialog.getByRole("textbox", { name: "From", exact: true }).fill(addDays(today, -7));
    await dialog.getByRole("button", { name: "Save shift" }).click();
    // The refusal sits on the date, and the dialog stays open to fix it.
    const date = dialog
      .getByRole("textbox", { name: "From", exact: true })
      .locator("xpath=ancestor::label");
    await expect(date.getByRole("alert")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("a change dated ahead leaves today as it is", async ({ page }) => {
    const ahead = tuesdayInWeeks(3);
    await page.goto(raviCard());
    await page.getByRole("tab", { name: "Employment" }).click();
    await page.getByRole("button", { name: "Change shift" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Shift", { exact: true }).selectOption({ label: "Their unit's shift" });
    await dialog.getByRole("textbox", { name: "From", exact: true }).fill(ahead);
    await dialog.getByRole("button", { name: "Save shift" }).click();
    await expect(dialog).toHaveCount(0);
    // Still on Gate night today; the history shows when it ends.
    const panel = page.getByTestId("panel-shift-calendar");
    await expect(panel).toContainText("Their own shift, since");
    await expect(page.getByTestId("own-shift-history")).not.toContainText("Current");
  });
});

test.describe("as a colleague", () => {
  test.use({ storageState: sessionFile("employee") });

  test("sees Ravi's shift but cannot change it", async ({ page }) => {
    await page.goto(raviCard());
    await page.getByRole("tab", { name: "Employment" }).click();
    await expect(page.getByTestId("panel-shift-calendar")).toContainText("Gate night");
    await expect(page.getByRole("button", { name: "Change shift" })).toHaveCount(0);
    // The history of his own shifts is his, his manager's and the Admin's.
    await expect(page.getByTestId("own-shift-history")).toHaveCount(0);
  });

  test("is not given Configuration, even by typing its address", async ({ page }) => {
    await page.goto("/app/employee/config");
    await expect(page.getByRole("heading", { name: "Configuration" })).toHaveCount(0);
    await expect(page.getByTestId("config-calendars")).toHaveCount(0);
  });
});

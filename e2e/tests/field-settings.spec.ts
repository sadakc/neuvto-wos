import { expect, test } from "@playwright/test";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

// Sada's fifth round (D107): the Super Admin decides which fields are required
// and which the person may update on their own card; the database holds both.

test.describe.configure({ mode: "serial" });

const priya = () =>
  sql(`select e.id from public.employees e join public.profiles p on p.id = e.profile_id
        where p.email = 'priya.emp@acme.test'`)[0];

test.describe("the Super Admin", () => {
  test.use({ storageState: sessionFile("superAdmin") });

  test("has an answer for every field and switches one on for employees", async ({ page }) => {
    sql(`delete from public.employee_field_settings`);
    await page.goto("/app/employee/config");
    const table = page.getByTestId("field-catalogue");
    await expect(table.getByRole("combobox", { name: "Required: Date of birth" })).toBeVisible();
    // Every row of the screen's catalogue is a field the database knows.
    await expect(table.getByTestId("setting-missing")).toHaveCount(0);
    const sex = table.getByRole("combobox", { name: "Employees can update: Sex" });
    await expect(sex).toHaveValue("no");
    await sex.selectOption("yes");
    await expect
      .poll(() =>
        sql(
          `select employee_can_update from public.employee_field_settings where field_key = 'sex'`,
        ),
      )
      .toEqual(["t"]);
    // A fixed answer has no control.
    await expect(table.getByRole("combobox", { name: "Employees can update: UAN" })).toHaveCount(0);
  });
});

test.describe("the Employee Admin", () => {
  test.use({ storageState: sessionFile("hr") });

  test("sees the answers but cannot change them", async ({ page }) => {
    await page.goto("/app/employee/config");
    await expect(page.getByTestId("field-settings-note")).toContainText(
      "Only a Super Admin can change these.",
    );
    await expect(page.getByTestId("field-catalogue").getByRole("combobox")).toHaveCount(0);
  });

  test("cannot save a record with a required field empty", async ({ page }) => {
    sql(`update public.employees set date_of_birth = null where id = '${priya()}'`);
    await page.goto(`/app/employee/directory/person?id=${priya()}`);
    await page.getByRole("tab", { name: "Personal" }).click();
    await page.getByTestId("edit-identity").click();
    await expect(page.getByTestId("required-identity")).toContainText("Date of birth");
    await page.getByTestId("save-identity").click();
    await expect(page.getByText("Date of birth can't be empty.")).toBeVisible();
  });
});

test.describe("the person", () => {
  test.use({ storageState: sessionFile("employee") });

  test("changes their own field, switched on, straight away", async ({ page }) => {
    await page.goto("/app/employee");
    await page.getByRole("tab", { name: "Personal" }).click();
    await page.getByTestId("edit-identity").click();
    const editor = page.getByTestId("editor-identity");
    // Sex was switched on above; date of birth was not.
    await expect(editor.getByLabel("Date of birth", { exact: true })).toHaveCount(0);
    await editor.getByRole("combobox", { name: "Sex" }).selectOption("male");
    await page.getByTestId("save-identity").click();
    await expect(editor).toHaveCount(0);
    expect(sql(`select sex from public.employees where id = '${priya()}'`)).toEqual(["male"]);
  });

  test("has no Edit on the panels that are the company's", async ({ page }) => {
    await page.goto("/app/employee");
    await page.getByRole("tab", { name: "Employment" }).click();
    await expect(page.getByTestId("edit-position")).toHaveCount(0);
    await expect(page.getByTestId("edit-dates")).toHaveCount(0);
  });
});

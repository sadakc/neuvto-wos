import { expect, test } from "@playwright/test";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

// Sada's first round (D103), the way he met it: an Admin adds somebody, invites
// them, and completes their card before they have accepted, with every field
// checked as it is saved and each panel's own Add or Edit in its header.

test.use({ storageState: sessionFile("hr") });
test.describe.configure({ mode: "serial" });

const NAME = "Deepak Dummy";

test("adding somebody: bad values are named, a department is added from the form", async ({
  page,
}) => {
  await page.goto("/app/employee/add");
  for (const id of ["add-designation", "add-department", "add-manager", "add-employment-type"]) {
    await expect(page.getByTestId(id).locator("option").first()).toHaveText("None");
  }
  await page.getByTestId("add-name").fill(NAME);
  await page.getByTestId("add-email").fill("deepak.dummy@acme.test");
  await page.getByTestId("add-phone").fill("34654365465");
  await page.getByTestId("add-send-invite").click();
  await expect(page.getByText("Enter a 10-digit mobile number")).toBeVisible();
  await page.getByTestId("add-phone").fill("98765 43210");
  await expect(page.getByText("Enter a 10-digit mobile number")).toHaveCount(0);

  await page.getByTestId("add-department").selectOption({ label: "Add a department…" });
  await page.getByLabel("New department").fill("Security");
  await page.getByTestId("add-inline").getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("add-department")).toHaveValue(/.+/);
  await expect(page.getByTestId("add-department").locator("option:checked")).toHaveText("Security");

  await page.getByTestId("add-send-invite").click();
  await page.waitForURL(/directory\/person\?id=/);
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
  await expect(page.getByText("Invited", { exact: true })).toBeVisible();
});

test("an invited person's card is completed, panel by panel, before they accept", async ({
  page,
}) => {
  const id = sql(
    `select e.id from public.employees e join public.invitations i on i.id = e.invitation_id
      where i.email = 'deepak.dummy@acme.test'`,
  )[0];
  await page.goto(`/app/employee/directory/person?id=${id}`);

  // Empty emergency contact: shown, with Add in its own header.
  const emergency = page.getByTestId("panel-emergency");
  await expect(emergency).toContainText("No emergency contact recorded yet.");
  await emergency.getByRole("button", { name: "Add emergency contact" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Lata");
  await dialog.getByLabel("Relation").fill("Sister");
  await dialog.getByLabel("Phone").fill("12345");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a 10-digit mobile number");
  await dialog.getByLabel("Phone").fill("+971 50 123 4567");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(emergency).toContainText("Lata");
  await expect(emergency.getByRole("button", { name: "Edit emergency contact" })).toBeVisible();

  // An 11-digit alternate mobile is refused, by the screen.
  const contact = page.getByTestId("panel-contact");
  await contact.getByRole("button", { name: "Edit contact" }).click();
  await dialog.getByLabel("Alternate mobile").fill("34654365465");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a 10-digit mobile number");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The name and the mobile, corrected before acceptance.
  await page.getByRole("tab", { name: "Personal" }).click();
  await page.getByTestId("panel-identity").getByRole("button", { name: "Edit identity" }).click();
  await dialog.getByLabel("Full name").fill("Deepak Kumar");
  await dialog.getByLabel("Nationality").fill("Indian1");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Letters only");
  await dialog.getByLabel("Nationality").fill("Indian");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Deepak Kumar" })).toBeVisible();

  // Empty panels say Add, in their own headers.
  await expect(page.getByRole("button", { name: "Add education" })).toBeVisible();
  await page.getByRole("tab", { name: "Family" }).click();
  await expect(page.getByRole("button", { name: "Add family" })).toBeVisible();

  // Reports to: somebody who cannot approve is made a Manager from the field.
  await page.getByRole("tab", { name: "Employment" }).click();
  await page.getByTestId("panel-position").getByTestId("edit-position").click();
  await expect(dialog.getByLabel("Reports to").locator("option").first()).toHaveText("None");
  await dialog.getByLabel("Reports to").selectOption({ label: "Make somebody a Manager…" });
  await dialog.getByLabel("Make a Manager").selectOption({ label: "Ravi Employee" });
  await dialog.getByTestId("add-inline").getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByLabel("Reports to").locator("option:checked")).toHaveText(
    "Ravi Employee",
  );
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("panel-position")).toContainText("Ravi Employee");
});

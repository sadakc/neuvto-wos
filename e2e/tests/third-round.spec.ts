import { expect, test } from "@playwright/test";
import { addDays, dmy } from "../support/dates";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

// Sada's third round (D105), on No Manager's record, so nothing here meets
// what the other files do to Priya and Deepak.

test.use({ storageState: sessionFile("hr") });
test.describe.configure({ mode: "serial" });

const card = () =>
  `/app/employee/directory/person?id=${
    sql(
      `select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a008'`,
    )[0]
  }`;
const today = sql(`select public.org_today('00000000-0000-0000-0000-0000000000a0')::text`)[0];

test("the shell: the Employee Card, tabs in the row, and a column that folds", async ({ page }) => {
  await page.goto("/app/employee/directory");
  await expect(page.getByRole("banner")).toContainText("Employee Card");
  const tabs = page.getByRole("navigation", { name: "Employee Card sections" });
  // At 1280 the Company tabs fit in the row, after their divider.
  await expect(tabs.getByTestId("company-divider")).toBeVisible();
  await expect(tabs.getByTestId("tab-company")).toHaveCount(0);
  const bar = await tabs.boundingBox();
  const lastTab = await tabs.locator("[data-testid^=tab-]").last().boundingBox();
  expect(lastTab!.x + lastTab!.width - bar!.x).toBeLessThanOrEqual(bar!.width * 0.7 + 1);

  await page.getByRole("button", { name: "Hide the modules column" }).click();
  await expect(page.getByTestId("rail-folded")).toBeVisible();
  const folded = await page.getByTestId("rail-folded").boundingBox();
  expect(folded!.width).toBeLessThan(80);
  await page.reload();
  await expect(page.getByTestId("rail-folded")).toBeVisible();
  await page.getByRole("button", { name: "Show the modules column" }).click();
  await expect(page.getByRole("button", { name: "Hide the modules column" })).toBeVisible();
});

test("deploy, move with an end date, remove the mistake, and move ahead", async ({ page }) => {
  await page.goto(card());
  const dialog = page.getByRole("dialog");
  // The Overview's Current deployment has its own button now.
  await page.getByTestId("panel-deployment").getByTestId("move-unit").click();
  for (const name of ["Belgaum Depot", "Hubli Gate"]) {
    await dialog.getByTestId("move-unit-select").selectOption({ label: "Add a unit…" });
    await dialog.getByLabel("New unit").fill(name);
    await dialog.getByTestId("add-inline").getByRole("button", { name: "Add" }).click();
    await expect(dialog.getByTestId("move-unit-select").locator("option:checked")).toHaveText(name);
  }
  await dialog.getByTestId("move-unit-select").selectOption({ label: "Belgaum Depot" });
  await dialog.getByRole("textbox", { name: "Effective from" }).fill(addDays(today, -20));
  await dialog.getByTestId("move-order-ref").fill("DO/1");
  await dialog.getByLabel("Expected duration, years").selectOption("1");
  await dialog.getByLabel("Expected duration, months").selectOption("6");
  await dialog.getByLabel("Reason for deploying").fill("New site");
  await dialog.getByTestId("move-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("panel-deployment")).toContainText("Belgaum Depot");

  // Move on: Belgaum ends on its own day; Hubli starts the day after, by itself.
  await page.getByTestId("panel-deployment").getByTestId("move-unit").click();
  await dialog.getByTestId("move-unit-select").selectOption({ label: "Hubli Gate" });
  await dialog
    .getByRole("textbox", { name: "Last day at Belgaum Depot" })
    .fill(dmy(addDays(today, -6)).replace(/\//g, ""));
  await expect(dialog.getByRole("textbox", { name: "Starts at the new unit on" })).toHaveValue(
    dmy(addDays(today, -5)),
  );
  await dialog.getByTestId("move-order-ref").fill("DO/2");
  await dialog.getByTestId("move-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("panel-deployment")).toContainText("Hubli Gate");

  // Hubli was a mistake: removed with a reason, and Belgaum carries on.
  await page.getByRole("tab", { name: "Employment" }).click();
  await page.getByTestId("remove-posting").first().click();
  await expect(dialog.getByRole("heading")).toHaveText("Remove the posting to Hubli Gate?");
  await expect(dialog.getByTestId("remove-posting-what-happens")).toContainText(
    "Belgaum Depot carries on as though this move had not been made.",
  );
  await dialog.getByTestId("remove-posting-reason").fill("Sent to Hubli by mistake");
  await dialog.getByTestId("remove-posting-confirm").click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("withdrawn-postings")).toContainText("Sent to Hubli by mistake");
  expect(
    sql(`select d.effective_to is null from public.employee_deployments d
          join public.deployment_units u on u.id = d.deployment_unit_id
         where u.name = 'Belgaum Depot'`),
  ).toEqual(["t"]);

  // Sada's bug: a move dated ahead left the card with no current unit.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByTestId("panel-deployment").getByTestId("move-unit").click();
  await dialog.getByTestId("move-unit-select").selectOption({ label: "Hubli Gate" });
  await dialog.getByRole("textbox", { name: "Starts at the new unit on" }).fill(addDays(today, 3));
  await dialog.getByTestId("move-order-ref").fill("DO/3");
  await dialog.getByTestId("move-save").click();
  await expect(dialog).toHaveCount(0);
  const panel = page.getByTestId("panel-deployment");
  await expect(panel).toContainText("Belgaum Depot");
  await expect(panel).toContainText(`Hubli Gate from`);
  await expect(page.getByText("Deployed unit").locator("..")).toContainText("Belgaum Depot");
});

test("one nomination for every scheme, corrected the same day", async ({ page }) => {
  await page.goto(card());
  await page.getByRole("tab", { name: "Family" }).click();
  const dialog = page.getByRole("dialog");
  for (const name of ["Ravi Kumar", "Lata Kumar"]) {
    await page.getByTestId("edit-nominees").click();
    await expect(dialog.getByText("Scheme")).toHaveCount(0);
    const rows = dialog.getByTestId("nominee-editor-row");
    if ((await rows.count()) === 0) await dialog.getByTestId("nominee-add-row").click();
    await dialog.getByLabel("Nominee name, row 1").fill(name);
    await rows.first().locator("select").selectOption("mother");
    await dialog.getByLabel("Share, row 1").fill("100");
    await dialog.getByTestId("nominee-save").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("nominee-table")).toContainText(name);
  }
  await expect(page.getByTestId("nominee-table")).not.toContainText("Ravi Kumar");
});

test("numbers: an old UAN that is the current one, and a driving licence", async ({ page }) => {
  await page.goto(card());
  await page.getByRole("tab", { name: "Statutory and bank" }).click();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Add PF and insurance numbers" }).click();
  await dialog.getByLabel("UAN", { exact: true }).fill("100200300400");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  // The current one is on record as its last four: the database refuses the match.
  await page.getByRole("button", { name: "Edit PF and insurance numbers" }).click();
  await dialog.getByLabel("Old UAN").fill("100200300400");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByTestId("editor-pf-error")).toHaveText(
    "The old UAN is the same as the current one. An old UAN is a previous account.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const ids = page.getByTestId("panel-identity-docs");
  await expect(ids).not.toContainText("Document given");
  await page.getByRole("button", { name: "Add identity documents" }).click();
  await dialog.getByLabel("Driving licence").fill("KA22 20190012345");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(ids.getByTestId("licence-masked")).toHaveText("•••• 2345");
  await ids.getByRole("button", { name: "Show driving licence" }).click();
  await expect(ids.getByTestId("licence-value")).toContainText("KA2220190012345");
});

test("a cheque photo on the bank panel is on the Documents tab too", async ({ page }) => {
  await page.goto(card());
  await page.getByRole("tab", { name: "Statutory and bank" }).click();
  const proof = page.getByTestId("bank-proof");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  await proof
    .getByLabel("Upload an image")
    .setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: png });
  await proof.getByTestId("bank-proof-upload").click();
  await expect(proof).toContainText("on file");
  await page.getByRole("tab", { name: "Documents" }).click();
  const row = page
    .getByTestId("document-row")
    .filter({ hasText: "Bank passbook first page or cancelled cheque" });
  await expect(row).toContainText("Uploaded");
  await expect(row.getByRole("button", { name: "View" })).toBeVisible();
});

test("an address starts with the state, and its districts follow it", async ({ page }) => {
  await page.goto(card());
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByTestId("add-address").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("address-state").locator("option:checked")).toHaveText(
    "Karnataka",
  );
  await dialog.getByTestId("address-district").selectOption("Belagavi");
  await dialog.getByTestId("address-line").fill("12 Khade Bazar");
  await dialog.getByLabel("City/Town").fill("Belagavi");
  await dialog.getByTestId("address-pincode").fill("590001");
  await dialog.getByTestId("address-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("12 Khade Bazar, Belagavi, Karnataka, India - 590001")).toBeVisible();
});

test("Change shift offers Save only for a change", async ({ page }) => {
  await page.goto(card());
  await page.getByRole("tab", { name: "Employment" }).click();
  await page.getByRole("button", { name: "Change shift" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("shift-unchanged")).toContainText(
    "They already work their unit's shift.",
  );
  await dialog.getByLabel("Reason (optional)").fill("x");
  await dialog.getByLabel("Reason (optional)").fill("");
  await expect(dialog.getByRole("button", { name: "Save shift" })).toBeDisabled();
});

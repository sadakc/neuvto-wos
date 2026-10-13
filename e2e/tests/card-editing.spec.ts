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
  await expect(page.getByText("A mobile number has 10 digits; this has 11.")).toBeVisible();
  // D104: ten digits that no mobile starts with is named for what it is.
  await page.getByTestId("add-phone").fill("3465436546");
  await expect(page.getByText("An Indian mobile number starts with 6, 7, 8 or 9.")).toBeVisible();
  await page.getByTestId("add-phone").fill("98765 43210");
  await expect(page.getByRole("alert")).toHaveCount(0);

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
  await dialog.getByLabel("Name", { exact: true }).fill("Lata");
  // D104: the relation is the nominee list, chosen.
  await expect(dialog.getByLabel("Relation").locator("option:checked")).toHaveText("Select");
  await dialog.getByLabel("Relation").selectOption({ label: "Sister" });
  await dialog.getByLabel("Phone", { exact: true }).fill("12345");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "A mobile number has 10 digits; this has 5.",
  );
  await dialog.getByLabel("Phone", { exact: true }).fill("+971 50 123 4567");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(emergency).toContainText("Lata");
  await expect(emergency.getByRole("button", { name: "Edit emergency contact" })).toBeVisible();

  // An 11-digit alternate mobile is refused, by the screen.
  const contact = page.getByTestId("panel-contact");
  await contact.getByRole("button", { name: "Edit contact" }).click();
  await dialog.getByLabel("Alternate mobile", { exact: true }).fill("34654365465");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("this has 11");
  // Sada's report (D104): cut to ten, it is still refused, and now says why.
  await dialog.getByLabel("Alternate mobile", { exact: true }).fill("3465436546");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("starts with 6, 7, 8 or 9");
  await dialog.getByLabel("Alternate mobile", { exact: true }).fill("9876543211");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(contact).toContainText("9876543211");

  // The name and the mobile, corrected before acceptance.
  await page.getByRole("tab", { name: "Personal" }).click();
  await page.getByTestId("panel-identity").getByRole("button", { name: "Edit identity" }).click();
  await dialog.getByLabel("Full name", { exact: true }).fill("Deepak Kumar");
  await dialog.getByLabel("Name as printed on ID", { exact: true }).fill("Deepak 2");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Letters only");
  // D105: the x clears a box in one go.
  await dialog.getByRole("button", { name: "Clear Name as printed on ID" }).click();
  await expect(dialog.getByLabel("Name as printed on ID", { exact: true })).toHaveValue("");
  // D105: native state is the list of states, Karnataka already chosen.
  await expect(dialog.getByLabel("Native state").locator("option:checked")).toHaveText("Karnataka");
  // D104: nationality is a dropdown, Indian already chosen.
  await expect(dialog.getByLabel("Nationality").locator("option:checked")).toHaveText("Indian");
  // The date of birth from the calendar: year and month are dropdowns.
  await dialog.getByRole("button", { name: "Choose date of birth from a calendar" }).click();
  const calendar = page.locator("[data-slot=calendar]");
  await calendar.getByRole("combobox").nth(1).selectOption("1990");
  await calendar.getByRole("combobox").nth(0).selectOption("4");
  await calendar.getByRole("button", { name: /May 1st, 1990/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Date of birth" })).toHaveValue("01/05/1990");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Deepak Kumar" })).toBeVisible();

  // Empty panels say Add, in their own headers.
  await expect(page.getByRole("button", { name: "Add education and experience" })).toHaveText(
    "Add",
  );
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

// ── Sada's second round (D104), on the same record.

const deepakCard = () =>
  `/app/employee/directory/person?id=${
    sql(
      `select e.id from public.employees e join public.invitations i on i.id = e.invitation_id
        where i.email = 'deepak.dummy@acme.test'`,
    )[0]
  }`;

test("experience, the physical record and a family row, chosen from lists", async ({ page }) => {
  await page.goto(deepakCard());
  const dialog = page.getByRole("dialog");
  await page.getByRole("tab", { name: "Personal" }).click();

  await page.getByRole("button", { name: "Add education and experience" }).click();
  await dialog.getByLabel("Experience before joining, years").selectOption("2");
  await dialog.getByLabel("Experience before joining, months").selectOption("6");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Experience before joining", { exact: true })).toBeVisible();
  // Not joined yet, so the total is the experience before joining alone.
  await expect(page.getByText("2 yr 6 mo", { exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "Add physical record" }).click();
  await dialog.getByLabel("Height").selectOption("170");
  await dialog.getByLabel("Weight").selectOption("72");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("170 cm")).toBeVisible();
  await expect(page.getByText("72 kg")).toBeVisible();
  await expect(page.getByTestId("panel-restricted")).toHaveCount(0);
  await expect(page.getByTestId("restricted-note")).toBeVisible();

  await page.getByRole("tab", { name: "Family" }).click();
  await page.getByRole("button", { name: "Add family" }).click();
  await expect(dialog.getByLabel("Relation, row 1").locator("option:checked")).toHaveText("Select");
  await dialog.getByLabel("Name, row 1").fill("Arjun");
  await dialog.getByTestId("family-save").click();
  await expect(dialog.getByTestId("family-editor-error")).toHaveText("Arjun: choose a relation.");
  await dialog.getByLabel("Relation, row 1").selectOption("son");
  await dialog.getByRole("textbox", { name: "Date of birth, row 1" }).fill("15082015");
  await dialog.getByTestId("family-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("family-table")).toContainText("Arjun");
  await expect(page.getByTestId("family-table")).toContainText("15 Aug 2015");
});

test("deploying to a unit that is added from the dialog", async ({ page }) => {
  await page.goto(deepakCard());
  await page.getByRole("tab", { name: "Employment" }).click();
  await page.getByTestId("move-unit").click();
  const dialog = page.getByRole("dialog");
  const deploy = dialog.getByTestId("move-save");
  await expect(deploy).toBeDisabled();
  await expect(dialog.getByTestId("move-missing")).toHaveText(
    "Still needed: a unit, the order reference.",
  );
  await dialog.getByTestId("move-unit-select").selectOption({ label: "Add a unit…" });
  await dialog.getByLabel("New unit").fill("Tata AIG, Hosur");
  await dialog.getByLabel("Client (for a client site)").fill("Tata AIG");
  await dialog.getByTestId("add-inline").getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByTestId("move-unit-select").locator("option:checked")).toHaveText(
    "Tata AIG, Hosur (Tata AIG)",
  );
  await dialog.getByTestId("move-order-ref").fill("DO/2026/114");
  await expect(deploy).toBeEnabled();
  await deploy.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Tata AIG, Hosur").first()).toBeVisible();
  expect(
    sql(
      `select unit_type, client_name from public.deployment_units where name = 'Tata AIG, Hosur'`,
    ),
  ).toEqual(["client_site|Tata AIG"]);
});

test("a document is chosen with Browse, unchosen, and uploaded", async ({ page }) => {
  await page.goto(deepakCard());
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload a document" }).click();
  await expect(page.getByRole("button", { name: "Browse…" })).toBeVisible();
  const upload = page.getByRole("button", { name: "Upload", exact: true });
  await expect(upload).toBeDisabled();
  const pdf = {
    name: "offer.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  };
  await page.getByLabel("File", { exact: true }).setInputFiles({ ...pdf, name: "wrong.pdf" });
  await expect(page.getByText("wrong.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Remove wrong.pdf" }).click();
  await expect(page.getByText("No file chosen")).toBeVisible();
  await expect(upload).toBeDisabled();
  await page.getByLabel("File", { exact: true }).setInputFiles(pdf);
  await upload.click();
  await expect(page.getByRole("button", { name: "Browse…" })).toHaveCount(0);
  await expect(page.getByTestId("document-row").first()).toContainText("Uploaded");
});

test("PF numbers open as their last four, and only the one changed is saved", async ({ page }) => {
  const priya = sql(
    `select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006'`,
  )[0];
  await page.goto(`/app/employee/directory/person?id=${priya}`);
  await page.getByRole("tab", { name: "Statutory and bank" }).click();
  const pf = page.getByTestId("panel-pf");
  const dialog = page.getByRole("dialog");

  // The seed holds none, so they are added first, all three at once.
  await page.getByRole("button", { name: "Add PF and insurance numbers" }).click();
  await dialog.getByLabel("UAN", { exact: true }).fill("100200300400");
  await dialog.getByLabel("EPF number").fill("MHBAN0012345000001234");
  await dialog.getByLabel("ESIC number", { exact: true }).fill("1234567890");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pf.getByTestId("epf-masked")).toHaveText("•••• 1234");
  const epfBefore = await pf.getByTestId("epf-masked").textContent();

  // Sada's report (D104): opening the form no longer looks like it cleared them.
  await page.getByRole("button", { name: "Edit PF and insurance numbers" }).click();
  await expect(dialog.getByTestId("masked-uan")).toHaveText(/•••• 0400/);
  await expect(dialog.getByTestId("masked-epfNumber")).toHaveText(/•••• 1234/);
  await expect(dialog.getByTestId("masked-esicNumber")).toHaveText(/•••• 7890/);
  await dialog.getByRole("button", { name: "Change UAN" }).click();
  await dialog.getByLabel("UAN", { exact: true }).fill("100000000001");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pf.getByTestId("uan-masked")).toHaveText("•••• 0001");
  await expect(pf.getByTestId("epf-masked")).toHaveText(epfBefore!);

  // The eye stays on the number's line once it is open.
  await pf.getByRole("button", { name: "Show EPF number" }).click();
  const hide = pf.getByRole("button", { name: "Hide EPF number" });
  await expect(hide).toBeVisible();
  const value = pf.getByTestId("epf-value").locator("span.font-mono");
  const [a, b] = [await value.boundingBox(), await hide.boundingBox()];
  expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(4);
});

test("the bank panel takes a photo of a cancelled cheque", async ({ page }) => {
  const priya = sql(
    `select id from public.employees where profile_id = '00000000-0000-0000-0000-00000000a006'`,
  )[0];
  await page.goto(`/app/employee/directory/person?id=${priya}`);
  await page.getByRole("tab", { name: "Statutory and bank" }).click();
  const proof = page.getByTestId("bank-proof");
  await expect(proof).toContainText("not uploaded yet");
  // A one-pixel PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  await proof
    .getByLabel("Upload an image")
    .setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: png });
  await expect(proof.getByTestId("bank-proof-file-name")).toHaveText("cheque.png");
  await proof.getByTestId("bank-proof-upload").click();
  await expect(proof).toContainText("on file");
  await expect(proof.getByRole("button", { name: "View" })).toBeVisible();
});

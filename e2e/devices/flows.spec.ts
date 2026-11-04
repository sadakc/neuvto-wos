import { expect, test } from "@playwright/test";
import { sql } from "../support/local";
import { sessionFile } from "../support/people";

/**
 * Things that broke only on a phone, done the way the phone does them. These
 * change data, which is why they run in the device lab and nowhere else.
 */

test.use({ storageState: sessionFile("hr") });

// A tiny valid PNG: the cheque photo.
const CHEQUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a cheque photo uploads over the Wi-Fi address (D118)", async ({ page }) => {
  // The browser feature the upload used to need is missing on an insecure page.
  await page.goto("/app");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

  const [priya] = sql(
    `select e.id from public.employees e join auth.users u on u.id = e.profile_id
      where u.email = 'priya.emp@acme.test'`,
  );
  const count = () =>
    Number(
      sql(`select count(*) from public.employee_documents
            where employee_id = '${priya}' and doc_type = 'bank_proof'`)[0],
    );
  const before = count();
  await page.goto(`/app/employee/directory/person?id=${priya}#section-statutory`);
  const proof = page.getByTestId("bank-proof");
  await expect(proof).not.toContainText("checking");
  // The second project to run finds the first one's photo, and replaces it.
  await proof
    .getByLabel(before ? "Replace the image" : "Upload an image")
    .setInputFiles({ name: "cheque.png", mimeType: "image/png", buffer: CHEQUE });
  await proof.getByTestId("bank-proof-upload").click();
  // Done when the chosen file is cleared: "on file" may be the earlier photo.
  await expect(proof.getByTestId("bank-proof-upload")).toBeHidden({ timeout: 30_000 });
  await expect(proof).toContainText("on file");
  expect(count()).toBe(before + 1);
  await expect(proof.getByRole("alert")).toHaveCount(0);
});

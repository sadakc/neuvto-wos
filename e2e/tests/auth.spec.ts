import { expect, test } from "@playwright/test";
import { codeFor, MAIL_URL } from "../support/local";

// Signing in by emailed code, the right way and the wrong ways.

test.describe("signing in", () => {
  test("a wrong code is refused, and the right one signs you in", async ({ page }) => {
    // Somebody global-setup did not sign in: one code per address every 10s.
    const email = "dan.director@acme.test";
    await page.goto("/auth");
    await page.getByLabel("Work email").fill(email);
    const since = Date.now();
    await page.getByRole("button", { name: "Email me a code" }).click();
    const code = await codeFor(email, since);

    // Wrong: one digit off. Still on the code screen afterwards.
    const wrong = code.replace(/\d$/, (d) => String((Number(d) + 1) % 10));
    await page.getByLabel("6-digit code").fill(wrong);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page).toHaveURL(/\/auth/);

    // Right.
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/app(\/|$)/);
    await expect(page.getByRole("heading", { name: "Welcome, Dan" })).toBeVisible();
  });

  test("the code box takes digits only, six at most", async ({ page }) => {
    await page.goto("/auth");
    // A different person: the auth server allows one code per address every 10s.
    await page.getByLabel("Work email").fill("newjoiner.emp@acme.test");
    await page.getByRole("button", { name: "Email me a code" }).click();
    const box = page.getByLabel("6-digit code");
    await box.pressSequentially("12ab34-5678");
    await expect(box).toHaveValue("123456");
  });

  test("an address nobody registered is told so, and gets no code", async ({ page }) => {
    await page.goto("/auth");
    const email = "nobody.here@acme.test";
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog.getByText("We can't find that address")).toBeVisible();
    await expect(dialog).toContainText("has not been registered");
    await dialog.getByRole("button", { name: "OK" }).click();
    // Back where they were, with the address they typed, and no code screen.
    await expect(page.getByLabel("Work email")).toHaveValue(email);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toHaveCount(0);
    const mail = await fetch(
      `${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`,
    ).then((r) => r.json() as Promise<{ messages: unknown[] }>);
    expect(mail.messages).toHaveLength(0);
  });

  test("the app sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/app/employee");
    await page.waitForURL(/\/auth/);
    await expect(page.getByLabel("Work email")).toBeVisible();
  });
});

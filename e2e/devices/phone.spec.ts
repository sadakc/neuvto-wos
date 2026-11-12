import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { sessionFile, type Role } from "../support/people";
import { everyDialog, layoutProblems, PHONE_SECTIONS, titleMenu } from "../support/phone-checks";
import { reachable, settle } from "../support/screens";

/**
 * Every screen each role can reach, at a phone's width and through the Wi-Fi
 * address (doc 11.7, D119). On each screen and each section inside it:
 *
 * - the phone shell: a 64px app bar, the bottom bar, no laptop tab row (1);
 * - nothing pushes the page sideways or sticks out past the screen (2, 6);
 * - the shell's controls are at least 48px each way (3);
 * - the title menu opens its sheet, and the sheet is whole on the screen (4).
 *
 * At 390 and on the iPhone it also opens every dialog and calendar
 * (phone-checks.ts, everyDialog) and checks each is whole on the screen.
 */

const ROLES: Role[] = ["hr", "employee", "manager"];

for (const role of ROLES) {
  test.describe(`on a phone, as ${role}`, () => {
    test.use({ storageState: sessionFile(role) });

    test("every screen is laid out for a phone", async ({ page }, info) => {
      test.setTimeout(1_200_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

      await page.goto("/app");
      // Loaded fully before the crawl loads it again: Safari reports a load cut
      // off half way as "Importing a module script failed".
      await settle(page);
      // The point of the Wi-Fi address: the page is as insecure as on a phone.
      expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

      const paths = await reachable(page);
      expect(paths.length).toBeGreaterThan(3);
      // Android and iOS walk the same screens; they cannot crawl at laptop size.
      mkdirSync("reports/devices", { recursive: true });
      writeFileSync(`reports/devices/paths-${role}.json`, JSON.stringify(paths));

      const deep = /phone-390|iphone/.test(info.project.name);
      const problems: string[] = [];
      let opened = 0;
      const look = async (where: string) => {
        problems.push(...(await layoutProblems(page, where)));
        problems.push(...(await titleMenu(page, where)));
        if (!deep) return;
        const walk = await everyDialog(page, where);
        problems.push(...walk.problems);
        opened += walk.opened;
      };
      for (const path of paths) {
        await page.goto(path);
        await settle(page);
        await look(path);
        // A card's sections and Configuration's, on a phone, are an index of rows.
        const views = page.locator(PHONE_SECTIONS);
        for (let i = 0; i < (await views.count()); i++) {
          const view = views.nth(i);
          if (!(await view.isVisible())) continue;
          const name = (await view.innerText()).trim().split("\n")[0];
          await view.click();
          await settle(page);
          await look(`${path} › ${name}`);
          await page.goto(path);
          await settle(page);
        }
      }
      console.log(`${role} @ ${info.project.name}: ${paths.length} screens, ${opened} dialogs`);
      if (deep) expect(opened, "no dialog was opened: the walk proved nothing").toBeGreaterThan(3);
      expect(problems, problems.join("\n")).toEqual([]);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}

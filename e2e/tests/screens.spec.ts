import { expect, test } from "@playwright/test";
import { reachable, settle, SUBVIEWS, unnamed } from "../support/screens";
import { sessionFile, type Role } from "../support/people";

/**
 * Every screen each role can reach, found by following the app's own links,
 * so a new screen is covered the day it is linked. On each one:
 *
 * - it loads: no "Page not found", no uncaught error in the browser;
 * - every button, link and field has a name a person (or a screen reader) can
 *   find it by;
 * - nothing pushes the page sideways.
 *
 * Read-only: nothing is clicked except links, so it runs at both sizes.
 */

const ROLES: Role[] = ["hr", "employee", "manager"];

for (const role of ROLES) {
  test.describe(`every screen, as ${role}`, () => {
    test.use({ storageState: sessionFile(role) });

    test("loads, names every control, and fits the width", async ({ page }) => {
      test.setTimeout(240_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

      const paths = await reachable(page);
      test.info().annotations.push({ type: "screens", description: paths.join(" ") });
      console.log(
        `${role} @ ${test.info().project.name}: ${paths.length} screens\n  ${paths.join("\n  ")}`,
      );
      expect(paths.length).toBeGreaterThan(3);
      const problems: string[] = [];
      let subviews = 0;
      for (const path of paths) {
        await page.goto(path);
        await settle(page);
        if (await page.getByRole("heading", { name: "Page not found" }).count())
          problems.push(`${path}: Page not found`);
        const check = async (where: string) => {
          for (const html of await unnamed(page)) problems.push(`${where}: unnamed ${html}`);
          const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          if (sideways) problems.push(`${where}: scrolls sideways`);
        };
        await check(path);
        const views = page.locator(SUBVIEWS);
        for (let i = 1; i < (await views.count()); i++) {
          const view = views.nth(i);
          const name = (await view.innerText()).trim();
          await view.click();
          await settle(page);
          await check(`${path} › ${name}`);
          subviews++;
        }
      }
      console.log(`  and ${subviews} tabs and sections inside them`);
      expect(problems, problems.join("\n")).toEqual([]);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}

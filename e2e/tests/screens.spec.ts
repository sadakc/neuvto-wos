import { expect, test, type Page } from "@playwright/test";
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

/**
 * Follows every link, at laptop size so nothing is folded away, and opens every
 * menu toggle on the way: the module rail's overflow, the tab bar's "Company"
 * and "More". A link only a menu holds is still a screen somebody reaches.
 */
async function reachable(page: Page): Promise<string[]> {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = new Set<string>(["/app"]);
  const queue = ["/app"];
  const collect = () =>
    page.$$eval("a[href^='/app']", (as) =>
      as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("#")[0]),
    );
  while (queue.length) {
    const path = queue.shift()!;
    await page.goto(path);
    await settle(page);
    const hrefs = await collect();
    const toggles = page.locator("button[aria-controls][aria-expanded='false']");
    for (let i = 0; i < (await toggles.count()); i++) {
      const t = toggles.nth(i);
      if (!(await t.isVisible())) continue;
      await t.click();
      hrefs.push(...(await collect()));
      await page.keyboard.press("Escape");
    }
    for (const h of hrefs) {
      // A person's card is one screen however many people there are.
      if (h.includes("/directory/person") && [...seen].some((x) => x.includes("/directory/person")))
        continue;
      if (!seen.has(h)) {
        seen.add(h);
        queue.push(h);
      }
    }
  }
  if (size) await page.setViewportSize(size);
  return [...seen].sort();
}

/** The parts of a screen that are views rather than links: card tabs, Configuration sections. */
const SUBVIEWS =
  '[role=tablist][aria-label="Record sections"] [role=tab], [data-testid^="config-"]';

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: 15_000 });
}

/** Controls with no name to find them by. */
function unnamed(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden";
    };
    const named = (el: Element) => {
      if (el.getAttribute("aria-label")?.trim()) return true;
      const by = el.getAttribute("aria-labelledby");
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim()))
        return true;
      if (el.getAttribute("title")?.trim()) return true;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
      if (el.closest("label")?.textContent?.trim()) return true;
      if (el.matches("button, a, [role=tab], [role=button]")) {
        return !!(el.textContent?.trim() || el.querySelector("img[alt]:not([alt=''])"));
      }
      return false;
    };
    return [
      ...document.querySelectorAll(
        "button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button]",
      ),
    ]
      .filter((el) => visible(el) && !named(el))
      .map((el) => el.outerHTML.slice(0, 120));
  });
}

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

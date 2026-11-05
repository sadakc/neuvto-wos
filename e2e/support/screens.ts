import { expect, type Page } from "@playwright/test";

/**
 * Finding every screen and checking it: shared by screens.spec.ts (laptop and
 * phone size, usual stack) and the device tests in e2e/devices (device lab).
 */

/**
 * Follows every link, at laptop size so nothing is folded away, and opens every
 * menu toggle on the way: the module rail's overflow, the tab bar's "Company"
 * and "More". A link only a menu holds is still a screen somebody reaches.
 */
export async function reachable(page: Page): Promise<string[]> {
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
export const SUBVIEWS =
  '[role=tablist][aria-label="Record sections"] [role=tab], [data-testid^="config-"]';

export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: 15_000 });
}

/** Controls with no name to find them by. */
export function unnamed(page: Page) {
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

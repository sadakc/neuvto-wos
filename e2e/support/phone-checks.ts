import type { Page } from "@playwright/test";
import { settle } from "./screens";

/**
 * The phone layout's acceptance checks (doc 11.7), each written as a list of
 * problems so one run reports every screen that fails, not just the first.
 *
 * The checks that look at the page are plain functions run inside it, so the
 * same code runs in Chrome and WebKit (Playwright), in Android Chrome
 * (Playwright's Android driver) and in iOS Safari (Appium, which has no
 * Playwright). Each must stay self-contained: it is sent to the browser as text.
 */

/** The shell's own controls, the hub and section lists: what doc 11 sizes at 48px. */
export const SHELL_TARGETS = [
  "[data-testid=app-bar] button",
  "[data-testid=bottom-nav] a",
  "[data-testid=hub] a",
  "[data-testid=hub] button",
  "[data-testid=section-sheet] a",
  "[data-testid=section-sheet] button",
  "nav[aria-label$=sections] button",
  "nav[aria-label$=sections] a",
  "nav[aria-label$=record] button",
].join(", ");

/** On a phone, a level's sections are an index of rows (doc 11.4): the record's, Configuration's, a sectioned page's. */
export const PHONE_SECTIONS =
  'main nav[aria-label$="sections"] li > button, main nav[aria-label$="record"] li > button';

/** Criteria 1, 2, 3 and 6, on the screen as it stands. Runs in the browser. */
export function layoutCheck({ where, targets }: { where: string; targets: string }): string[] {
  const out: string[] = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1)
    out.push(`${where}: scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
  const bar = document.querySelector("[data-testid=app-bar]");
  if (!bar) out.push(`${where}: no phone app bar`);
  else {
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h !== 64) out.push(`${where}: app bar is ${h}px, not 64`);
  }
  if (!document.querySelector("[data-testid=bottom-nav]")) out.push(`${where}: no bottom bar`);
  if (document.querySelector("nav[data-mode], [data-rail]"))
    out.push(`${where}: the laptop tab row or rail is on the phone`);
  // Something wider than the screen, outside a table's own scroller.
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= doc.clientWidth + 1) continue;
    if (el.closest(".overflow-x-auto, .overflow-auto, .overflow-hidden, [data-scroll-x]")) continue;
    out.push(`${where}: sticks out past the screen: ${el.outerHTML.slice(0, 100)}`);
    break;
  }
  for (const el of document.querySelectorAll(targets)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 48 || r.width < 48)
      out.push(
        `${where}: tap target ${Math.round(r.width)}×${Math.round(r.height)}: ${el.outerHTML.slice(0, 100)}`,
      );
  }
  // iOS Safari zooms the whole page in when a field under 16px is tapped, and
  // leaves it zoomed: the screen is then cut off on the right.
  for (const el of document.querySelectorAll<HTMLElement>(
    "main input:not([type=checkbox], [type=radio], [type=file], [type=hidden]), main select, main textarea",
  )) {
    if (!el.getClientRects().length) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) {
      const label = el.getAttribute("aria-label") || el.id || el.getAttribute("name") || el.tagName;
      out.push(`${where}: a field's text is ${size}px, under 16, so iOS zooms in on it: ${label}`);
      break;
    }
  }
  return out;
}

/** Every open dialog or sheet whole on the screen. Runs in the browser. */
export function dialogCheck(where: string): string[] {
  const out: string[] = [];
  // The visible part of the page: on a phone, what the keyboard has not covered.
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const h = vv ? vv.height : window.innerHeight;
  const w = document.documentElement.clientWidth;
  for (const d of document.querySelectorAll("[role=dialog], [role=alertdialog]")) {
    const r = d.getBoundingClientRect();
    if (r.height === 0) continue;
    const name =
      d.querySelector("h2, [id$=title]")?.textContent?.trim() ||
      d.getAttribute("data-testid") ||
      "a dialog";
    if (r.top < top - 1 || r.bottom > top + h + 1 || r.left < -1 || r.right > w + 1)
      out.push(
        `${where} › ${name}: off the screen (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}; visible ${Math.round(top)}–${Math.round(top + h)}, width ${w})`,
      );
    // A sheet's header stays at its very top while the fields scroll under it
    // (D120). Stuck lower, what scrolls under it shows above it (Sada's phone,
    // 4 Nov 2026). Measured scrolled to the bottom, then put back.
    const header = d.querySelector<HTMLElement>("[data-sheet-header]");
    const scroller = d as HTMLElement;
    if (
      header &&
      getComputedStyle(header).position === "sticky" &&
      scroller.scrollHeight > scroller.clientHeight
    ) {
      const before = scroller.scrollTop;
      scroller.scrollTop = scroller.scrollHeight;
      const gap = header.getBoundingClientRect().top - (r.top + scroller.clientTop);
      scroller.scrollTop = before;
      if (Math.abs(gap) > 1)
        out.push(
          `${where} › ${name}: its header sticks ${Math.round(gap)}px from the top of the sheet; what scrolls under it shows above it`,
        );
    }
  }
  // iOS Safari zooms the whole page in when a field under 16px is tapped, and
  // leaves it zoomed: the screen is then cut off on the right.
  for (const el of document.querySelectorAll<HTMLElement>(
    "[role=dialog] input:not([type=checkbox], [type=radio], [type=file], [type=hidden]), [role=dialog] select, [role=dialog] textarea",
  )) {
    if (!el.getClientRects().length) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) {
      const label = el.getAttribute("aria-label") || el.id || el.getAttribute("name") || el.tagName;
      out.push(`${where}: a field's text is ${size}px, under 16, so iOS zooms in on it: ${label}`);
      break;
    }
  }
  return out;
}

/**
 * With the on-screen keyboard up: the focused field and the top dialog's
 * title both inside what the keyboard leaves visible (D116). Runs in the browser.
 */
export function keyboardCheck(where: string): string[] {
  const out: string[] = [];
  const vv = window.visualViewport;
  if (!vv) return [`${where}: no visualViewport to measure`];
  const top = vv.offsetTop;
  const bottom = vv.offsetTop + vv.height;
  if (vv.height > window.screen.height * 0.75)
    out.push(`${where}: the keyboard does not seem to be up (visible ${Math.round(vv.height)}px)`);
  const field = document.activeElement;
  if (!field || !field.matches("input, textarea, select"))
    out.push(`${where}: no field has the focus`);
  else {
    const r = field.getBoundingClientRect();
    if (r.top < top - 1 || r.bottom > bottom + 1)
      out.push(
        `${where}: the field being typed in is hidden (${Math.round(r.top)}–${Math.round(r.bottom)}; visible ${Math.round(top)}–${Math.round(bottom)})`,
      );
  }
  const dialogs = [...document.querySelectorAll("[role=dialog]")].filter(
    (d) => d.getBoundingClientRect().height > 0,
  );
  const title = dialogs.at(-1)?.querySelector("h2, [id$=title]");
  if (title) {
    const r = title.getBoundingClientRect();
    if (r.bottom < top + 1 || r.top > bottom)
      out.push(
        `${where}: the sheet's title is out of sight behind the keyboard or the address bar`,
      );
  }
  return out;
}

export const layoutProblems = (page: Page, where: string) =>
  page.evaluate(layoutCheck, { where, targets: SHELL_TARGETS });
export const dialogsFit = (page: Page, where: string) => page.evaluate(dialogCheck, where);
export const keyboardProblems = (page: Page, where: string) => page.evaluate(keyboardCheck, where);

/** Lets a sheet finish sliding in or out before it is measured. */
export const settleSheet = (page: Page) => page.waitForTimeout(350);

/** Criterion 4: the title menu opens its sheet, whole on the screen. */
export async function titleMenu(page: Page, where: string): Promise<string[]> {
  const menu = page.getByTestId("title-menu");
  if (!(await menu.isVisible())) return [`${where}: no title menu`];
  await menu.click();
  const sheet = page.getByTestId("section-sheet");
  const shown = await sheet
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return [`${where}: the title menu opened nothing`];
  await settleSheet(page);
  const out = [
    ...(await dialogsFit(page, `${where} › title menu`)),
    ...(await layoutProblems(page, `${where} › title menu`)).filter((p) =>
      p.includes("tap target"),
    ),
  ];
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
  return out;
}

/** Buttons that open a dialog, a sheet or a calendar, by their own markup or by their name. */
const OPENERS =
  'main button[aria-haspopup="dialog"], main button[aria-label$="from a calendar"], ' +
  'main button:text-matches("^(Edit|Add|Change|Request|Apply)\\\\b", "i")';
const CALENDARS = '[role=dialog] button[aria-label$="from a calendar"]';

/**
 * Opens every dialog and calendar on the screen, then every calendar inside
 * each dialog, and checks each is whole on the screen: the calendar that ran
 * off the top of Sada's phone (D118) was one of these. Opening is all it does;
 * nothing is saved. Counts what it opened, since a walk that opens nothing
 * proves nothing.
 */
export async function everyDialog(
  page: Page,
  where: string,
): Promise<{ problems: string[]; opened: number }> {
  const problems: string[] = [];
  let opened = 0;
  const url = page.url();
  const openers = page.locator(OPENERS);
  const count = await openers.count();
  for (let i = 0; i < count; i++) {
    const opener = openers.nth(i);
    if (!(await opener.isVisible()) || !(await opener.isEnabled())) continue;
    const name = ((await opener.getAttribute("aria-label")) ?? (await opener.innerText())).trim();
    await opener.click();
    const dialog = page.locator("[role=dialog], [role=alertdialog]").last();
    const isDialog = await dialog
      .waitFor({ timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (!isDialog) {
      // Not a dialog after all: an inline editor, or a link. Put the screen back.
      if (page.url() !== url) {
        await page.goto(url);
        await settle(page);
      }
      continue;
    }
    await settleSheet(page);
    opened++;
    problems.push(...(await dialogsFit(page, `${where} › ${name}`)));
    const calendars = page.locator(CALENDARS);
    for (let j = 0; j < (await calendars.count()); j++) {
      const cal = calendars.nth(j);
      if (!(await cal.isVisible())) continue;
      const label = (await cal.getAttribute("aria-label")) ?? "calendar";
      await cal.click();
      await settleSheet(page);
      opened++;
      problems.push(...(await dialogsFit(page, `${where} › ${name} › ${label}`)));
      await page.keyboard.press("Escape");
      await settleSheet(page);
    }
    await page.keyboard.press("Escape");
    await page
      .locator("[role=dialog], [role=alertdialog]")
      .first()
      .waitFor({ state: "hidden", timeout: 3_000 })
      .catch(async () => {
        await page.goto(url);
        await settle(page);
      });
  }
  return { problems, opened };
}

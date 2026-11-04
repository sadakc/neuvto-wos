import {
  _android as android,
  expect,
  test,
  type AndroidDevice,
  type Locator,
  type Page,
} from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { codeFor } from "../support/local";
import { PEOPLE, type Role } from "../support/people";
import {
  dialogsFit,
  everyDialog,
  keyboardProblems,
  layoutProblems,
  PHONE_SECTIONS,
  titleMenu,
} from "../support/phone-checks";
import { settle } from "../support/screens";

/**
 * Real Chrome on the Android Emulator (D119): its own address bar and its own
 * on-screen keyboard, which Chrome on a Mac pretending to be a phone has
 * neither of. Start it first: bash scripts/android-emulator.sh start
 *
 * - every screen the phone-390 run found, laid out for a phone, with every
 *   dialog and calendar whole on the screen;
 * - every editor on Priya's own record with the keyboard raised by a real tap
 *   on its last field: the field and the sheet's title both still in sight (D116).
 */

let device: AndroidDevice | undefined;

test.beforeAll(async () => {
  [device] = await android.devices();
});
test.afterAll(async () => {
  await device?.close();
});

async function chrome(role: Role): Promise<Page> {
  test.skip(!device, "No Android Emulator: bash scripts/android-emulator.sh start");
  // A fresh Chrome for each person: the last one's session stays otherwise.
  await device!.shell("am force-stop com.android.chrome");
  await device!.shell("pm clear com.android.chrome");
  const context = await device!.launchBrowser({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/auth");
  await declinePrompts();
  // Submitted with the keyboard's Enter, as a phone does: focusing the field
  // raises Android's keyboard, which can leave the button under something else.
  const email = PEOPLE[role].email;
  await page.getByLabel("Work email").fill(email);
  const since = Date.now();
  await page.getByLabel("Work email").press("Enter");
  await page.getByLabel("6-digit code").fill(await codeFor(email, since));
  await page.getByLabel("6-digit code").press("Enter");
  await page.waitForURL(/\/app(\/|$)/);
  return page;
}

for (const role of ["employee", "hr"] as Role[]) {
  test(`every screen in Android Chrome, as ${role}`, async () => {
    test.setTimeout(1_200_000);
    const page = await chrome(role);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    const file = `reports/devices/paths-${role}.json`;
    expect(existsSync(file), `${file}: run the phone-390 project first`).toBe(true);
    const paths = JSON.parse(readFileSync(file, "utf8")) as string[];
    const problems: string[] = [];
    let opened = 0;
    const look = async (where: string) => {
      problems.push(...(await layoutProblems(page, where)));
      problems.push(...(await titleMenu(page, where)));
      const walk = await everyDialog(page, where);
      problems.push(...walk.problems);
      opened += walk.opened;
    };
    for (const path of paths) {
      await page.goto(path);
      await settle(page);
      await look(path);
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
    console.log(`${role} @ android: ${paths.length} screens, ${opened} dialogs`);
    expect(problems, problems.join("\n")).toEqual([]);
    await page.context().close();
  });
}

/**
 * Every editor on Priya's own record, with the keyboard raised by a real tap on
 * its last field: that field and the sheet's title both still in sight (D116).
 * A short sheet fits above the keyboard however the page behaves, so it is the
 * tall ones that prove anything; all of them are opened.
 */
test("the keyboard leaves the field and the sheet's title in sight (D116)", async () => {
  test.setTimeout(900_000);
  const page = await chrome("employee");
  const problems: string[] = [];
  let tried = 0;
  let calendarsOpened = 0;
  for (const section of ["overview", "personal", "family"]) {
    await page.goto(`/app/employee#section-${section}`);
    await settle(page);
    const editors = page.locator("main [data-testid^=edit-]");
    if (!(await editors.first().isVisible())) {
      await page.screenshot({ path: `reports/devices/android-no-editors-${section}.png` });
      problems.push(`${section}: no editor to open on ${page.url()}`);
    }
    for (let i = 0; i < (await editors.count()); i++) {
      const opener = editors.nth(i);
      if (!(await opener.isVisible())) continue;
      const name = (await opener.getAttribute("data-testid"))!;
      await opener.click();
      const sheet = page.locator("[role=dialog]").last();
      if (!(await sheet.isVisible().catch(() => false))) await page.waitForTimeout(1_000);
      if (!(await sheet.isVisible())) continue;
      await page.waitForTimeout(400);
      problems.push(...(await dialogsFit(page, name)));
      const fields = sheet.locator(
        "input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea",
      );
      if ((await fields.count()) === 0) {
        await closeSheet(page);
        continue;
      }
      const last = fields.nth((await fields.count()) - 1);
      if (!(await tapToType(page, last))) {
        problems.push(`${name}: a tap on its last field did not land in it`);
        await page.screenshot({ path: `reports/devices/android-missed-${name}.png` });
      } else {
        tried++;
        await page.waitForTimeout(800);
        await page.screenshot({ path: `reports/devices/android-keyboard-${name}.png` });
        problems.push(...(await keyboardProblems(page, `${name}, keyboard up`)));
        // Then each calendar in the sheet, by a finger, just after typing: the
        // calendar that ran off the top of Sada's phone (D118) was opened so.
        const calendars = sheet.locator('button[aria-label$="from a calendar"]');
        for (let j = 0; j < (await calendars.count()); j++) {
          const cal = calendars.nth(j);
          const label = (await cal.getAttribute("aria-label"))!;
          // The first tap may only put the keyboard away; tap until it opens.
          const grid = page.locator("[role=grid]");
          for (let k = 0; k < 3 && !(await grid.isVisible()); k++) {
            await fingerOn(page, cal);
            await grid.waitFor({ timeout: 2_000 }).catch(() => undefined);
          }
          if (!(await grid.isVisible())) {
            problems.push(`${name} › ${label}: a tap did not open it`);
            continue;
          }
          await page.waitForTimeout(600);
          calendarsOpened++;
          await page.screenshot({ path: `reports/devices/android-calendar-${name}-${j}.png` });
          problems.push(...(await dialogsFit(page, `${name} › ${label}`)));
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }
      }
      await closeSheet(page);
    }
  }
  console.log(`keyboard @ android: ${tried} editors typed into, ${calendarsOpened} calendars`);
  expect(problems, problems.join("\n")).toEqual([]);
  expect(tried, "no editor was typed into: the test proved nothing").toBeGreaterThan(2);
  expect(calendarsOpened, "no calendar was opened in a sheet").toBeGreaterThan(0);
  await page.context().close();
});

/**
 * A real tap on the emulator's touch screen, which raises the keyboard; a click
 * from Playwright focuses the field without it. Opening a sheet focuses its
 * first field, which raises the keyboard and moves the page while this
 * measures, so it measures again until the tap lands.
 */
async function tapToType(page: Page, field: Locator): Promise<boolean> {
  const focused = () => field.evaluate((el) => el === document.activeElement);
  for (let attempt = 0; attempt < 4; attempt++) {
    // The sheet closed under the tap: it landed on the page behind it.
    if ((await field.count()) === 0 || !(await field.isVisible())) return false;
    if (await focused()) break;
    await field.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_000);
    await fingerOn(page, field);
  }
  if (!(await focused())) return false;
  // The keyboard is up when it has taken the bottom of the screen from the page.
  await expect
    .poll(() => page.evaluate(() => window.visualViewport!.height / window.screen.height), {
      timeout: 15_000,
    })
    .toBeLessThan(0.75);
  return true;
}

/**
 * Taps an element by a finger on the touch screen. What the person sees is the
 * visual viewport, which sits at the bottom of Chrome's content area, above the
 * keyboard; with the keyboard up and the page not resized it is panned across
 * the page, so the element is measured from where it is panned to.
 */
async function fingerOn(page: Page, target: Locator) {
  const holder = bounds(await screenTree(), "com.android.chrome:id/compositor_view_holder");
  const at = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport!;
    return {
      ratio: window.devicePixelRatio,
      visible: vv.height,
      x: r.left + r.width / 2 - vv.offsetLeft,
      y: r.top + r.height / 2 - vv.offsetTop,
    };
  });
  const top = holder.bottom - at.visible * at.ratio;
  await tap(holder.left + at.x * at.ratio, top + at.y * at.ratio);
}

async function closeSheet(page: Page) {
  if (!(await page.locator("[role=dialog]").count())) return;
  await page.keyboard.press("Escape");
  await page.locator("[role=dialog]").first().waitFor({ state: "hidden", timeout: 5_000 });
}

/**
 * A finger on the emulator's touch screen. Through adb rather than Playwright's
 * own taps, which need a helper app installed on the phone.
 */
async function tap(x: number, y: number) {
  await device!.shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
}

/** Android's own description of what is on the screen, as uiautomator writes it. */
async function screenTree(): Promise<string> {
  await device!.shell("uiautomator dump /sdcard/neuvto-ui.xml");
  return (await device!.shell("cat /sdcard/neuvto-ui.xml")).toString();
}

function bounds(tree: string, match: string) {
  const node = tree.split("<node").find((n) => n.includes(match));
  const m = node && /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  if (!m) throw new Error(`Nothing on the Android screen matches ${match}`);
  const [left, top, right, bottom] = m.slice(1).map(Number);
  return { left, top, right, bottom };
}

/**
 * Chrome's own prompts after a fresh start ("Chrome notifications make things
 * easier") sit in front of the page and swallow real taps. Declined, which is
 * also the private choice.
 */
async function declinePrompts() {
  for (let i = 0; i < 3; i++) {
    const tree = await screenTree();
    const no = ["No thanks", "No, thanks", "Not now", "Don’t allow", "Don't allow"].find((t) =>
      tree.includes(`text="${t}"`),
    );
    if (!no) return;
    const b = bounds(tree, `text="${no}"`);
    await tap((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

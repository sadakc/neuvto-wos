/**
 * Safari on the iOS Simulator: Apple's real Safari, with its own keyboard and
 * address bar, which WebKit in Playwright has neither of (D119).
 *
 *   bash scripts/device-lab.sh up              the device lab's database
 *   bun run e2e:devices --project phone-390    once, so the screens to walk are known
 *   bun run e2e:ios                            this file
 *
 * Playwright cannot drive iOS Safari, so this drives it through Appium (free,
 * `npm i -g appium@4.0.0-beta.7 && appium driver install xcuitest`) over plain
 * WebDriver calls, with the same checks the Playwright tests run.
 *
 * Signs in through the real screen, typing with the iOS keyboard, then for each
 * person: every screen the Playwright run found, laid out for a phone; then
 * every editor on Priya's record with the keyboard up (D116).
 */

import { lab } from "./lab-env";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { codeFor, MAIL_URL } from "../support/local";
import { PEOPLE, type Role } from "../support/people";
import { dialogCheck, layoutCheck, SHELL_TARGETS } from "../support/phone-checks";

if (MAIL_URL !== lab.E2E_MAIL_URL) throw new Error(`Not the device lab's mail: ${MAIL_URL}`);
const BASE = lab.E2E_BASE_URL;
const DEVICE = process.env.IOS_DEVICE ?? "iPhone 17";
const APPIUM = "http://127.0.0.1:4723";
const ROLES: Role[] = ["employee", "hr"];

type Json = Record<string, unknown>;

async function wd(method: string, path: string, body?: Json): Promise<Json> {
  const res = await fetch(`${APPIUM}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    // Starting a session builds WebDriverAgent the first time: many minutes,
    // past Bun's own five-minute limit on a request, which this turns off.
    timeout: false,
  } as RequestInit);
  const json = (await res.json()) as { value: Json };
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value).slice(0, 400)}`);
  return json.value;
}

class Safari {
  constructor(private id: string) {}
  static async open() {
    const v = await wd("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          platformName: "iOS",
          browserName: "Safari",
          "appium:automationName": "XCUITest",
          "appium:deviceName": DEVICE,
          "appium:newCommandTimeout": 600,
          "appium:safariInitialUrl": BASE,
          "appium:wdaLaunchTimeout": 600_000,
          // Xcode 27 ships no Simulator window app; the simulator runs
          // headless, and Appium otherwise waits for that window forever.
          "appium:isHeadless": true,
          // Safari's page reaches the Web Inspector slowly on a busy Mac; the
          // default five seconds is not enough.
          "appium:webviewConnectTimeout": 60_000,
        },
      },
    });
    return new Safari(v.sessionId as string);
  }
  go(url: string) {
    return wd("POST", `/session/${this.id}/url`, { url: new URL(url, BASE).href });
  }
  url() {
    return wd("GET", `/session/${this.id}/url`) as unknown as Promise<string>;
  }
  /** Runs a function in the page, as Playwright's page.evaluate does. */
  run<T>(fn: (arg: never) => T, arg?: unknown): Promise<T> {
    return wd("POST", `/session/${this.id}/execute/sync`, {
      script: `return (${fn.toString()})(arguments[0]);`,
      args: [arg ?? null],
    }) as unknown as Promise<T>;
  }
  async find(css: string): Promise<string> {
    const v = await wd("POST", `/session/${this.id}/element`, {
      using: "css selector",
      value: css,
    });
    return Object.values(v)[0] as string;
  }
  click(el: string) {
    return wd("POST", `/session/${this.id}/element/${el}/click`, {});
  }
  type(el: string, text: string) {
    return wd("POST", `/session/${this.id}/element/${el}/value`, { text });
  }
  async waitFor(css: string, ms = 20_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.run((s: string) => !!document.querySelector(s), css)) return;
      await sleep(250);
    }
    throw new Error(`Nothing matched ${css} within ${ms / 1000}s on ${await this.url()}`);
  }
  /** Until the sign-in page's scripts have loaded and taken over its form. */
  async settleSignIn() {
    const end = Date.now() + 20_000;
    while (Date.now() < end && (await this.run(() => document.readyState !== "complete")))
      await sleep(250);
    await sleep(1_000);
  }
  /** Until the app's frame is drawn and nothing is still loading: a busy Mac is slow to. */
  async settle() {
    await sleep(800);
    const end = Date.now() + 20_000;
    while (
      Date.now() < end &&
      !(await this.run(
        () =>
          !!document.querySelector("[data-testid=app-bar]") &&
          !document.querySelector(".animate-pulse"),
      ))
    )
      await sleep(250);
    await sleep(300);
  }
  screenshot(file: string) {
    return wd("GET", `/session/${this.id}/screenshot`).then((png) =>
      writeFileSync(file, Buffer.from(png as unknown as string, "base64")),
    );
  }
  close() {
    return wd("DELETE", `/session/${this.id}`);
  }
  /**
   * Where iOS itself draws things, in screen points. With the iOS keyboard up
   * the page's own measurements disagree with the screen (the visual viewport
   * reports a pan the fixed sheet does not follow), so what is in sight is
   * read from iOS's own view of the screen instead.
   */
  async onScreen(
    field: string,
    title: string,
  ): Promise<{ keyboard?: Box; web?: Box; field?: Box; title?: Box }> {
    const web = (await wd("GET", `/session/${this.id}/context`)) as unknown as string;
    await wd("POST", `/session/${this.id}/context`, { name: "NATIVE_APP" });
    try {
      // The first drawn element of the first kind that matches. Kinds matter: the
      // sheet itself carries its title's name, so a title is looked for as text
      // and a field as a field, never as whatever else shares the name.
      const rect = async (...chains: string[]): Promise<Box | undefined> => {
        for (const chain of chains) {
          const els = (await wd("POST", `/session/${this.id}/elements`, {
            using: "-ios class chain",
            value: chain,
          })) as unknown as Json[];
          for (const el of els) {
            const id = Object.values(el)[0] as string;
            const r = (await wd("GET", `/session/${this.id}/element/${id}/rect`)) as unknown as Box;
            if (r.width > 0 && r.height > 0) return r;
          }
        }
        return undefined;
      };
      const named = (kind: string, name: string) =>
        `**/XCUIElementType${kind}[\`label BEGINSWITH[c] "${name.replace(/"/g, '\\"')}"\`]`;
      return {
        keyboard: await rect("**/XCUIElementTypeKeyboard"),
        web: await rect("**/XCUIElementTypeWebView"),
        field: await rect(
          named("TextField", field),
          named("TextView", field),
          named("SecureTextField", field),
        ),
        title: await rect(named("StaticText", title)),
      };
    } finally {
      await wd("POST", `/session/${this.id}/context`, { name: web });
    }
  }
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * With the iOS keyboard up: the field being typed in and the sheet's title both
 * between the top of the page and the top of the keyboard (D116, D120).
 */
async function keyboardOnScreen(s: Safari, where: string): Promise<string[]> {
  const { field, title } = await s.run(() => {
    const el = document.activeElement as HTMLInputElement | null;
    const label =
      el?.getAttribute("aria-label") ||
      (el?.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
      el?.closest("label")?.textContent?.trim() ||
      "";
    const sheets = document.querySelectorAll("[role=dialog]");
    const h = sheets[sheets.length - 1]?.querySelector("h2, [id$=title]");
    return {
      field: el?.matches("input, textarea, select") ? label : "",
      title: h?.textContent?.trim() ?? "",
    };
  });
  if (!field)
    return [
      `${where}: no named field has the focus (${await s.run(() => document.activeElement?.outerHTML.slice(0, 120) ?? "nothing")})`,
    ];
  const found = await s.onScreen(field, title);
  const { keyboard, web } = found;
  if (!keyboard) return [`${where}: the iOS keyboard is not up`];
  const top = web?.y ?? 0;
  const out: string[] = [];
  for (const [what, box] of [
    [`the field being typed in ("${field}")`, found.field],
    [`the sheet's title ("${title}")`, found.title],
  ] as const) {
    if (!box) out.push(`${where}: ${what} is not on the screen at all`);
    else if (box.y < top - 1 || box.y + box.height > keyboard.y + 1)
      out.push(
        `${where}: ${what} is out of sight (${Math.round(box.y)}–${Math.round(box.y + box.height)}; page from ${Math.round(top)}, keyboard from ${Math.round(keyboard.y)})`,
      );
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(s: Safari, email: string) {
  // A fresh start for each person: no session left from the last one.
  await s.go("/auth");
  await s.run(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  // On a busy Mac the button can be pressed before the page has finished
  // loading, and the browser then reloads the page instead: so up to three tries.
  const emailField = "input[type=email], input[autocomplete=email], input[name=email]";
  const codeField = "input[autocomplete=one-time-code], input[inputmode=numeric]";
  let since = 0;
  for (let attempt = 1; ; attempt++) {
    await s.go("/auth");
    await s.settleSignIn();
    await s.waitFor(emailField);
    await s.type(await s.find(emailField), email);
    since = Date.now();
    await s.click(await s.find("button[type=submit]"));
    try {
      await s.waitFor(codeField);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  const code = await codeFor(email, since);
  await s.type(await s.find("input[autocomplete=one-time-code], input[inputmode=numeric]"), code);
  await s.click(await s.find("button[type=submit]"));
  const end = Date.now() + 30_000;
  while (!/\/app(\/|$|\?)/.test(await s.url())) {
    if (Date.now() > end) throw new Error(`${email} did not reach /app`);
    await sleep(300);
  }
}

async function main() {
  const problems: string[] = [];
  const shots = "reports/devices/ios";
  mkdirSync(shots, { recursive: true });

  // The app on the device lab, unless it is already being served.
  const up = () =>
    fetch(BASE)
      .then((r) => r.ok)
      .catch(() => false);
  let app: ReturnType<typeof spawn> | undefined;
  if (!(await up())) {
    app = spawn("bash", ["scripts/device-lab.sh", "dev"], { stdio: "ignore" });
    for (let i = 0; i < 240 && !(await up()); i++) await sleep(500);
  }

  // Appium, unless one is already listening.
  let appium: ReturnType<typeof spawn> | undefined;
  if (
    !(await fetch(`${APPIUM}/status`)
      .then((r) => r.ok)
      .catch(() => false))
  ) {
    appium = spawn("appium", ["--log-level", "error"], { stdio: "ignore" });
    for (
      let i = 0;
      i < 60 &&
      !(await fetch(`${APPIUM}/status`)
        .then((r) => r.ok)
        .catch(() => false));
      i++
    )
      await sleep(500);
  }
  console.log(
    `Safari on the ${DEVICE} simulator, at ${BASE} (the first run builds WebDriverAgent: minutes)`,
  );
  const s = await Safari.open();
  try {
    if (await s.run(() => window.isSecureContext))
      problems.push("The page is secure: these checks are not seeing what a phone sees");

    for (const role of ROLES) {
      await signIn(s, PEOPLE[role].email);
      const file = `reports/devices/paths-${role}.json`;
      if (!existsSync(file))
        throw new Error(`${file} is missing: run bun run e2e:devices --project phone-390 first`);
      const paths = JSON.parse(readFileSync(file, "utf8")) as string[];
      for (const path of paths) {
        await s.go(path);
        await s.settle();
        problems.push(
          ...(await s.run(layoutCheck, { where: `${role} ${path}`, targets: SHELL_TARGETS })),
        );
      }
      console.log(`  ${role}: ${paths.length} screens`);
    }

    // The keyboard (D116): every editor on Priya's own record, its last field
    // tapped (a WebDriver click on iOS is a real tap, which raises the
    // keyboard). A short sheet fits above the keyboard regardless, so all are
    // opened: the tall ones are the ones that prove anything.
    await signIn(s, PEOPLE.employee.email);
    let typed = 0;
    for (const section of ["overview", "personal", "family"]) {
      await s.go(`/app/employee#section-${section}`);
      await s.settle();
      await s.waitFor("main [data-testid^=edit-]").catch(() => undefined);
      const editors = await s.run(() =>
        [...document.querySelectorAll("main [data-testid^=edit-]")]
          .filter((el) => el.getBoundingClientRect().height > 0)
          .map((el) => el.getAttribute("data-testid")!),
      );
      if (!editors.length) problems.push(`${section}: no editor to open`);
      for (const name of editors) {
        await s.click(await s.find(`[data-testid="${name}"]`));
        await sleep(800);
        if (!(await s.run(() => !!document.querySelector("[role=dialog]")))) continue;
        problems.push(...(await s.run(dialogCheck, name)));
        const last = await s.run(() => {
          const all = [
            ...document.querySelectorAll(
              "[role=dialog] input:not([type=checkbox]):not([type=radio]):not([type=file]), [role=dialog] textarea",
            ),
          ];
          all.forEach((el, i) => el.setAttribute("data-ios-field", String(i)));
          return all.length - 1;
        });
        if (last >= 0) {
          await s.run(
            (i: number) =>
              document
                .querySelector(`[data-ios-field="${i}"]`)
                ?.scrollIntoView({ block: "center" }),
            last,
          );
          await s.click(await s.find(`[data-ios-field="${last}"]`));
          await sleep(1200);
          await s.screenshot(`${shots}/keyboard-${name}.png`);
          problems.push(...(await keyboardOnScreen(s, `${name}, keyboard up`)));
          typed++;
        }
        // Closed by its own Close button; how it closes is not under test.
        await s.run(() => {
          const sheets = document.querySelectorAll("[role=dialog]");
          const close = [...(sheets[sheets.length - 1]?.querySelectorAll("button") ?? [])].find(
            (b) => b.getAttribute("aria-label") === "Close" || b.textContent?.trim() === "Close",
          );
          (close as HTMLButtonElement | undefined)?.click();
        });
        await sleep(600);
      }
    }
    console.log(`  keyboard: ${typed} editors typed into`);
    if (typed < 3)
      problems.push(`Only ${typed} editors were typed into: the keyboard check proved little`);
  } finally {
    await s.close().catch(() => undefined);
    appium?.kill();
    app?.kill();
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s) on iOS Safari:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\niOS Safari: every check passed. Screenshots: ${shots}/`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

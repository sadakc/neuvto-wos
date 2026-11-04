# Testing on phones

**Version:** 1.1 · **Status:** Active · **Updated:** 4 Nov 2026

How the app is tested the way a phone uses it (D119): every screen at three
phone widths, Safari's engine, real Android Chrome on the Android Emulator and
real Safari on the iOS Simulator. All free; nothing here costs money.

## Why this exists

Three bugs Sada found on his phone in one week had passed every test:

| Bug (D116, D118)                           | Why the tests missed it                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| The keyboard hid the field being typed in  | Chrome on a Mac pretending to be a phone draws no keyboard                         |
| A cheque photo would not upload            | Tests ran on localhost, which browsers treat as secure; the phone's address is not |
| The calendar ran off the top of the screen | A Mac window at phone width has no address bar taking up the top                   |

Each suite below closes one of those gaps.

## The device lab: a second database, so your data is safe

The browser tests re-seed their database and change its data. The local stack
(ports 543xx) holds what Sada is testing by hand, so device tests never touch
it. They use the **device lab**: a second local stack, same migrations and
functions, its own containers and ports (553xx), built from `supabase/` every
time it starts so it never drifts.

```bash
bash scripts/device-lab.sh up     # start (or rebuild) and seed it: a few minutes the first time
bash scripts/device-lab.sh dev    # the app against it, at http://<Wi-Fi address>:8090
bash scripts/device-lab.sh down   # stop it
```

`.env.local` is never read or written by any of this.

## The suites

```bash
bun run e2e:devices --project phone-360 --project phone-390 --project phone-430 --project iphone
bash scripts/android-emulator.sh start          # add --headless to hide the window
bun run e2e:devices --project android
bash scripts/android-emulator.sh stop
bash scripts/android-emulator.sh start --small  # a 360 by 640 phone: the least room
bun run e2e:devices --project android -g keyboard
bash scripts/android-emulator.sh stop
bun run e2e:ios
IOS_DEVICE="Neuvto small iPhone" bun run e2e:ios   # an iPhone SE, 375 by 667: the least room
xcrun simctl shutdown all
```

Run one device at a time. With both stacks, the emulator and the simulator
up together the Mac stalls, and the tests fail on timeouts rather than on
anything in the app.

| Suite        | File                           | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone widths | `e2e/devices/phone.spec.ts`    | Every screen each role reaches, and every section inside it, at 360, 390 and 430px: no sideways scroll; the 64px app bar and bottom bar, no laptop tab row; shell controls at least 48px; the title menu opens its sheet. At 390 it also opens every dialog and calendar, and every calendar inside each dialog, and checks each is whole on the screen (doc 11.7). On every screen and in every dialog, no field under 16px, which iOS Safari zooms in on (D120) |
| iPhone       | same, project `iphone`         | All of the above in WebKit, Safari's engine, at iPhone size                                                                                                                                                                                                                                                                                                                                                                                                       |
| Flows        | `e2e/devices/flows.spec.ts`    | A cheque photo uploads over the Wi-Fi address                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Android      | `e2e/devices/android.spec.ts`  | Every screen again in real Android Chrome, every dialog and calendar opened; then every editor on Priya's record with the keyboard raised by a real tap on its last field (the field and the sheet's title still visible), and each calendar in the sheet tapped open just after (whole on the screen)                                                                                                                                                            |
| iOS          | `e2e/devices/ios-simulator.ts` | Signs in by typing with the iOS keyboard; every screen in Apple's Safari; every editor on Priya's record with the iOS keyboard up, the field and the sheet's title read from where iOS itself draws them, above the keyboard. The page's own measurements disagree with the screen once the iOS keyboard is up, so they are not used for this                                                                                                                     |

Every suite first checks the page is **not** a secure page. If it ever is,
the suite is not seeing what a phone sees.

The checks themselves are in `e2e/support/phone-checks.ts`, written once and
run in all four browsers. The screens walked on Android and iOS are the ones
the `phone-390` run found, saved in `reports/devices/paths-<role>.json`, so
run `phone-390` first.

Results, screenshots and traces land in `reports/devices/` (not committed).

## Which check catches which bug

Each guard was proved by putting the bug back and watching the check fail
(3 Nov 2026):

| Put back                                                    | Caught by                                         | Not caught by                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A 56px app bar                                              | phone widths, every screen                        | —                                                                                  |
| The keyboard covering the page (D116, `interactive-widget`) | Android, Pixel 7 and small phone                  | Chrome or WebKit at phone width                                                    |
| The calendar as a popover in a sheet (D118)                 | Android, small phone                              | Chrome at 390; Android on the Pixel 7, which has room for it                       |
| Uploads with `crypto.randomUUID` (D118)                     | flows, over the Wi-Fi address                     | any test on localhost                                                              |
| Fields at 14px, which iOS zooms in on (D120, 4 Nov 2026)    | phone widths at 390; iOS Safari                   | Android, which does not zoom                                                       |
| A sheet sized to the screen, not to what is visible (D120)  | Android, Pixel 7 (HR's sheets); iOS, small iPhone | iOS on the iPhone 17, where the sheets fit anyway                                  |
| A sheet header that scrolls away with the fields (D120)     | Android, small phone                              | Android on the Pixel 7 and both iPhones, where those sheets fit above the keyboard |

So the Chrome and WebKit runs are the broad sweep, fast and every screen;
the emulator runs are the ones that catch what only a phone does. Both are
needed.

## Setting up a Mac

| Tool                        | Install                                                                                                                                                                                  | Size         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| WebKit for Playwright       | `bunx playwright install webkit`                                                                                                                                                         | about 100 MB |
| Android Studio and its SDK  | `brew install --cask android-studio android-commandlinetools`, then `sdkmanager emulator platform-tools "system-images;android-35;google_apis;arm64-v8a"` (accepts Google's SDK licence) | about 5 GB   |
| iOS Simulator               | Xcode, then `xcodebuild -downloadPlatform iOS`                                                                                                                                           | about 8 GB   |
| Appium, to drive iOS Safari | `npm i -g appium@4.0.0-beta.7 && appium driver install xcuitest`                                                                                                                         | about 300 MB |

The Android tests use the Java inside Android Studio; nothing else needs
Java. The first iOS run on each simulator builds Apple's WebDriverAgent,
which takes several minutes once.

The small iPhone is a simulator made once:

```bash
xcrun simctl create "Neuvto small iPhone" com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation
```

Xcode 27 has no Simulator window, so the iOS run starts the simulator
without one (Appium's `isHeadless`); it would otherwise wait for the window
forever. Safari's page can take most of a minute to reach Appium on a busy
Mac; a run that stops with "The remote debugger did not return any connected
web applications" was too slow to start, not a failure in the app. Run it
again.

## Who runs it

The `device-tester` agent (`.claude/agents/device-tester.md`) runs these
suites and reproduces what Sada finds on his phone, on the matching emulator
or simulator. It reports; fixes go to `ui-doctor` through `screen-prover`.

## What still needs a real phone

Emulators are close, not identical: battery-saving behaviour, the real
camera when a document is photographed, and a slow mobile network. Those still
want a look on Sada's phone before release.

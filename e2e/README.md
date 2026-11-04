# e2e/ — browser tests

**Version:** 1.1 · **Status:** Active · **Updated:** 4 Nov 2026

Playwright drives the real app in the Chrome installed on this Mac, signed in as the seeded test people, against the **local** stack. The full rules are in §8 of `docs/standards/NEUVTO_CODING_STANDARDS.md`.

```bash
supabase start     # the local database, in Docker
bun run e2e        # every test, about six minutes; starts the dev server if it is not running
bun run e2e:ui     # Playwright's window: watch each step, re-run one test
```

In VS Code, the Playwright extension (recommended in `.vscode/extensions.json`) shows each test with a run button.

| Path                      | What it holds                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `global-setup.ts`         | Refuses a non-local database, re-seeds, switches the Employee module on, signs each person in once                                              |
| `support/local.ts`        | The local-only guard, the database, and reading sign-in codes from the local mail catcher                                                       |
| `support/people.ts`       | Who the tests sign in as: Hema (HR), Priya (employee), Mark (manager), Ravi (colleague)                                                         |
| `support/dates.ts`        | Dates that are always bookable working days                                                                                                     |
| `tests/auth.spec.ts`      | Signing in: a wrong code, an unregistered address, the code box, the redirect                                                                   |
| `tests/leave.spec.ts`     | Applying for leave: what the form stops, and what the server refuses                                                                            |
| `tests/approvals.spec.ts` | Approving and rejecting, and what the employee then sees                                                                                        |
| `tests/employee.spec.ts`  | Shifts: setting one up, giving it to somebody, a clashing date, who is offered the controls                                                     |
| `tests/screens.spec.ts`   | Every screen each role can reach, at laptop and phone size: every control named, nothing sideways                                               |
| `devices/`                | Phone tests in the device lab, over the Wi-Fi address: Chrome, WebKit, Android Emulator, iOS Simulator. See `docs/operations/DEVICE_TESTING.md` |
| `support/screens.ts`      | Finding every screen by following the app's links; shared by the screen and device tests                                                        |
| `support/phone-checks.ts` | The phone layout checks (doc 11.7), run in all four browsers                                                                                    |

Results land in `reports/e2e/` (not committed). After a failure, `bunx playwright show-report reports/e2e/html` opens screenshots and a step-by-step trace.

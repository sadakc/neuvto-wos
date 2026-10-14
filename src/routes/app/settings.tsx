import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import {
  administersAnyModule,
  getCurrentUser,
  isAdmin,
  isModuleAdmin,
  type CurrentUser,
} from "@/platform/auth";
import { isAppError } from "@/platform/errors";
import {
  addHoliday,
  listCalendars,
  listHolidays,
  removeHoliday,
  type CalendarOption,
  type Holiday,
} from "@/platform/calendar";
import { HolidayCalendars } from "@/platform/calendar/HolidayCalendars";
import { getAdminSections, OrgModules, type ModuleAdminSection } from "@/platform/modules";
import { CompanyIdentity } from "@/platform/organization/CompanyIdentity";
import { Departments } from "@/platform/organization/Departments";
import { WorkingCalendar } from "@/platform/calendar/WorkingCalendar";
import { DateField } from "@/components/shared/date-field";
import { isIsoDate } from "@/components/shared/date-rules";
import { SectionedPage, type PageSection } from "@/components/shared/sectioned-page";
import { formatDate } from "@/lib/dates";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Settings — Neuvto WOS" }] }),
  component: SettingsPage,
});

/**
 * Configuration, not code.
 *
 * This page was read-only and said so: "editing arrives with the admin screens."
 * It was the first place Sada looked for leave configuration and the reason he
 * could not set his workspace up. Everything here is now editable, and the
 * blocks each module contributes are rendered underneath — so configuring leave
 * lives inside the Leave module while this file still names no module at all.
 */
function SettingsPage() {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const moduleKey = typeof search.m === "string" ? search.m : undefined;
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  /** D102: a holiday can be limited to some calendars. */
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [sections, setSections] = useState<(ModuleAdminSection & { moduleKey: string })[]>([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [holidayName, setHolidayName] = useState("");
  /** The holiday about to be removed: removing changes future counts, so it asks. */
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const [holidayDate, setHolidayDate] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const u = await getCurrentUser();
        if (cancelled) return;
        setUser(u);

        // D84: a module's admin reaches this page for their own module's
        // sections. The company's settings stay with a company-wide Admin.
        if (!administersAnyModule(u)) {
          setState("denied");
          return;
        }

        // None of these are worth blanking the page for — the settings above
        // are still editable if the holiday list or the module sections fail.
        const [h, sec, cal] = await Promise.allSettled([
          isAdmin(u) ? listHolidays() : Promise.resolve([]),
          getAdminSections(u),
          isAdmin(u) ? listCalendars() : Promise.resolve([]),
        ]);
        if (!cancelled) {
          if (h.status === "fulfilled") setHolidays(h.value);
          if (cal.status === "fulfilled") setCalendars(cal.value);
          if (sec.status === "fulfilled") {
            setSections(sec.value.filter((s) => isModuleAdmin(u, s.moduleKey)));
          }
        }

        setState("ready");
      } catch (e) {
        if (cancelled) return;
        console.error("settings load failed", e);
        setMessage("We couldn't load your settings.");
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !holidayName.trim() || !isIsoDate(holidayDate)) return;
    setError("");
    try {
      await addHoliday(user.organizationId, holidayName.trim(), holidayDate);
      setHolidays(await listHolidays());
      setHolidayName("");
      setHolidayDate("");
    } catch (e) {
      setError(isAppError(e) ? e.message : "That holiday couldn't be added.");
    }
  }

  async function onRemoveHoliday(id: string) {
    setRemoving(null);
    setError("");
    try {
      await removeHoliday(id);
      setHolidays(await listHolidays());
    } catch (e) {
      setError(isAppError(e) ? e.message : "That holiday couldn't be removed.");
    }
  }

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-page-title font-semibold tracking-page-title">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace settings are managed by your administrator.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-page-title font-semibold tracking-page-title">This didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  // D84. A module's admin sees only that module's sections.
  const companyWide = isAdmin(user);

  // Opened from a module's Configuration tab (?m=), the page is that module's
  // configuration alone; from Organisation, the company's own settings
  // (Sada, 14 Oct 2026: each module's configuration belongs to the module).
  const mine = sections.filter((s) => (moduleKey ? s.moduleKey === moduleKey : !companyWide));
  const company: PageSection[] =
    companyWide && !moduleKey
      ? [
          {
            id: "company",
            label: "Your company",
            description:
              "What this workspace is called, and the mark your people see on every screen and in every email from it.",
            content: <CompanyIdentity />,
          },
          {
            // Shared with the setup wizard. It lived here in full until the
            // wizard needed the same weekend picker, and a weekend whose rules
            // exist in two files is a weekend that eventually means two things.
            id: "calendar",
            label: "Working calendar",
            description:
              "Changing the working week or the financial year changes how every future request is counted. Leave already booked is not recalculated.",
            content: user && <WorkingCalendar organizationId={user.organizationId} />,
          },
          {
            id: "departments",
            label: "Departments",
            description:
              "How your workforce is grouped on reports. Somebody's department is set on their row under People, or from the department column of a spreadsheet import.",
            content: user && <Departments organizationId={user.organizationId} />,
          },
          {
            id: "holidays",
            label: "Holidays",
            description:
              "Days excluded from leave when a request spans them. Shared with attendance and shift planning when those arrive.",
            content: (
              <>
                <form onSubmit={onAddHoliday} className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    aria-label="Holiday name"
                    value={holidayName}
                    onChange={(e) => setHolidayName(e.target.value)}
                    placeholder="Republic Day"
                    className="h-12 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <DateField
                    label="Holiday date"
                    value={holidayDate}
                    max={`${new Date().getFullYear() + 2}-12-31`}
                    onChange={setHolidayDate}
                    className="sm:w-48"
                  />
                  <button
                    type="submit"
                    disabled={!holidayName.trim() || !isIsoDate(holidayDate)}
                    data-testid="add-holiday"
                    className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>

                {/* Set by both handlers below and, until now, rendered nowhere — so a
            holiday that failed to save failed in silence and the row simply
            did not appear. Caught by lint, not by anybody using the screen. */}
                {error && (
                  <p
                    role="alert"
                    data-testid="holidays-error"
                    className="mt-4 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}

                {holidays.length === 0 ? (
                  <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                    No holidays configured yet. Until some are added, only non-working days are
                    excluded.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                    {holidays.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-4 p-4">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{h.name}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {new Date(h.holidayDate + "T00:00:00").toLocaleDateString(undefined, {
                              weekday: "short",
                            })}{" "}
                            {formatDate(h.holidayDate)}
                          </span>
                          <HolidayCalendars
                            holiday={h}
                            calendars={calendars}
                            onSaved={async () => setHolidays(await listHolidays())}
                          />
                        </span>
                        <button
                          onClick={() => setRemoving(h)}
                          className="inline-flex h-12 shrink-0 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Remove {removing?.name ?? "this holiday"}?
                      </AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <p>
                            From now on that date is counted as a working day, so leave applied for
                            over it uses one more day.
                          </p>
                          <p>Leave already applied for is not recounted.</p>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setRemoving(null)}>
                        Keep it
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => removing && void onRemoveHoliday(removing.id)}
                      >
                        Remove {removing?.name ?? ""}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ),
          },
          {
            id: "modules",
            label: "Modules",
            description:
              "What this workspace has, and what is switched on. Neuvto adds modules to your workspace; switching them on and off is yours.",
            content: <OrgModules user={user} />,
          },
        ]
      : [];

  // Whatever the modules contribute. This file names none of them, the reason
  // "configure leave types" can live inside src/modules/leave.
  const contributed: PageSection[] = mine.map((section) => {
    const Section = section.component;
    return {
      id: `${section.moduleKey}-${section.id}`,
      label: section.title,
      description: section.description,
      content: (
        <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
          <Section />
        </Suspense>
      ),
    };
  });

  return (
    <SectionedPage
      title={moduleKey ? "Configuration" : companyWide ? "Workspace settings" : "Module settings"}
      description={
        moduleKey
          ? "How this module works in your company. The company's own settings are under Organisation, Settings."
          : companyWide
            ? "Configuration your organisation owns. Each module's own configuration is in that module, under Configuration."
            : "Configuration for the modules you administer. Company settings are kept by your administrator."
      }
      sections={[...company, ...contributed]}
      testIdPrefix="settings"
      empty="Nothing here to configure yet."
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser, isAdmin } from "@/platform/auth";
import { listHolidays, getFinancialYear, type Holiday } from "@/platform/calendar";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Settings — Neuvto WOS" }] }),
  component: SettingsPage,
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Settings {
  timezone: string;
  fy_start_month: number;
  fy_start_day: number;
  weekend_days: number[];
  exclude_weekends: boolean;
  exclude_holidays: boolean;
  allow_retroactive: boolean;
  default_min_notice_days: number;
  session_idle_minutes: number;
  session_absolute_hours: number;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function SettingsPage() {
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [financialYear, setFinancialYear] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;

        if (!isAdmin(user)) {
          setState("denied");
          return;
        }

        const { data, error } = await supabase
          .from("organization_settings")
          .select(
            "timezone, fy_start_month, fy_start_day, weekend_days, exclude_weekends, exclude_holidays, allow_retroactive, default_min_notice_days, session_idle_minutes, session_absolute_hours",
          )
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          setMessage("No configuration found for this workspace.");
          setState("error");
          return;
        }

        setSettings(data as Settings);

        // The calendar is a platform service; this is its first consumer.
        // Failures here must not blank the whole page — the settings above are
        // still worth showing.
        const [holidayResult, fyResult] = await Promise.allSettled([
          listHolidays(),
          user ? getFinancialYear(user.organizationId) : Promise.resolve(""),
        ]);
        if (!cancelled) {
          if (holidayResult.status === "fulfilled") setHolidays(holidayResult.value);
          if (fyResult.status === "fulfilled") setFinancialYear(fyResult.value);
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
        <h1 className="font-display text-lg font-semibold">Administrators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace settings are managed by your administrator.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">This didn&apos;t load</h1>
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

  const s = settings!;
  const weekend = s.weekend_days.map((d) => DAYS[d]).join(" and ");

  const rows: Array<{ label: string; value: string; note?: string }> = [
    {
      label: "Time zone",
      value: s.timezone,
      note: "Every date check resolves here, never against the server clock",
    },
    {
      label: "Financial year starts",
      value: `${ordinal(s.fy_start_day)} ${MONTHS[s.fy_start_month - 1]}`,
      note: "Drives leave entitlement and annual reset",
    },
    { label: "Weekend", value: weekend || "None" },
    {
      label: "Weekends count as leave",
      value: s.exclude_weekends ? "No — excluded" : "Yes — included",
    },
    {
      label: "Holidays count as leave",
      value: s.exclude_holidays ? "No — excluded" : "Yes — included",
    },
    {
      label: "Backdated requests",
      value: s.allow_retroactive ? "Allowed" : "Not allowed",
    },
    {
      label: "Minimum notice",
      value:
        s.default_min_notice_days === 0
          ? "None"
          : `${s.default_min_notice_days} day${s.default_min_notice_days === 1 ? "" : "s"}`,
    },
    { label: "Sign-out after inactivity", value: `${s.session_idle_minutes} minutes` },
    { label: "Maximum session length", value: `${s.session_absolute_hours} hours` },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-xl font-semibold tracking-tight">Workspace settings</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        These are configuration, not code — each one is a value your organisation owns, and editing
        arrives with the admin screens.
      </p>

      <dl className="mt-8 divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
          >
            <dt className="text-sm font-medium">{row.label}</dt>
            <dd className="sm:text-right">
              <span className="text-sm tabular-nums text-foreground">{row.value}</span>
              {row.note && <p className="mt-0.5 text-xs text-muted-foreground">{row.note}</p>}
            </dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 font-display text-lg font-semibold tracking-tight">
        Holidays
        {financialYear && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            financial year {financialYear}
          </span>
        )}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Days excluded from leave when a request spans them. Shared with attendance and shift
        planning when those arrive.
      </p>

      {holidays.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No holidays configured yet. Until some are added, only weekends are excluded from leave.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-baseline justify-between gap-4 p-4">
              <span className="text-sm font-medium">{h.name}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {new Date(h.holidayDate + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

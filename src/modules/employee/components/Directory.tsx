/**
 * Directory (bundle §7.4): everybody in the company, with what everybody may
 * see. `employee_directory()` returns no personal, family, address, statutory
 * or bank field for anybody, so there is nothing here to hide by role.
 *
 * Search is server side, 200ms after the last keystroke. A slower answer to an
 * older search is dropped, never shown under a newer one.
 *
 * The three filters narrow what the search returned. Their options are built
 * from those rows PLUS whatever is selected, so a selected department never
 * drops out of its own select when a search narrows the rows; a select whose
 * value is missing from its options shows the first option instead, which is
 * the "Reports to: Nobody" bug (screen-prover).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { isAppError } from "@/platform/errors";
import {
  EMPLOYEE_STATUS_LABEL,
  STAGE_LABEL,
  type DirectoryRow,
  type EmployeeStatus,
} from "../contracts";
import { STAGE_TONE } from "../status";
import { getDirectory } from "../handlers";
import { formatDate } from "../format";
import { PersonLink } from "./PersonLink";

const TONE: Record<EmployeeStatus, StatusTone> = {
  working: "success",
  probation: "info",
  notice: "warning",
  suspended: "destructive",
  left: "neutral",
};

export const SEARCH_DEBOUNCE_MS = 200;

function optionsFrom(values: (string | null)[], selected: string): string[] {
  const set = new Set(values.filter((v): v is string => !!v));
  if (selected) set.add(selected);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export default function Directory() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [unit, setUnit] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(
      () => {
        getDirectory(query)
          .then((r) => {
            if (ticket !== latest.current) return;
            setRows(r);
            setError("");
          })
          .catch((e: unknown) => {
            if (ticket !== latest.current) return;
            setError(isAppError(e) ? e.message : "The directory didn't load. Please try again.");
          });
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const shown = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!department || r.department === department) &&
          (!status || r.status === status) &&
          (!unit || r.deployedUnit === unit),
      ),
    [rows, department, status, unit],
  );

  const departments = optionsFrom(
    (rows ?? []).map((r) => r.department),
    department,
  );
  const units = optionsFrom(
    (rows ?? []).map((r) => r.deployedUnit),
    unit,
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Directory</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Everybody in your company. Open a name for their card.
        </p>
      </div>

      <div className="grid gap-2 @min-[560px]/app:grid-cols-3 @min-[1100px]/app:grid-cols-[2fr_1fr_1fr_1fr]">
        <label className="min-w-0 @min-[560px]/app:col-span-3 @min-[1100px]/app:col-span-1">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code, designation or department"
            data-testid="directory-search"
            className="h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <FilterSelect
          label="Department"
          value={department}
          onChange={setDepartment}
          testId="filter-department"
        >
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Status" value={status} onChange={setStatus} testId="filter-status">
          {Object.entries(EMPLOYEE_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Deployed unit" value={unit} onChange={setUnit} testId="filter-unit">
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </FilterSelect>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="directory-error"
          className="rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {rows === null && !error ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : (
        <section className="min-w-0 rounded-xl border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[56rem] border-collapse text-table-cell"
              data-testid="directory-table"
            >
              <thead>
                <tr className="border-b border-border text-left">
                  {[
                    "Employee",
                    "Designation",
                    "Department",
                    "Reports to",
                    "Deployed unit",
                    "Mobile",
                    "Joined",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 text-table-header font-semibold tracking-table-header whitespace-nowrap text-muted-foreground uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    data-testid="directory-row"
                    className={
                      r.isActive
                        ? "border-b border-border last:border-0"
                        : "border-b border-border text-muted-foreground last:border-0"
                    }
                  >
                    <td className="px-4 py-2.5">
                      <PersonLink employeeId={r.id} className="font-medium">
                        {r.fullName ?? r.workEmail ?? "Unnamed"}
                      </PersonLink>
                      {r.employeeCode && (
                        <span className="block font-mono text-caption text-muted-foreground">
                          {r.employeeCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{r.designation ?? "—"}</td>
                    <td className="px-4 py-2.5">{r.department ?? "—"}</td>
                    <td className="px-4 py-2.5">{r.reportsTo ?? "—"}</td>
                    <td className="px-4 py-2.5">{r.deployedUnit ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{r.mobile ?? "—"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.dateOfJoining)}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge tone={TONE[r.status]}>
                          {EMPLOYEE_STATUS_LABEL[r.status]}
                        </StatusBadge>
                        {r.stage !== "active" && (
                          <StatusBadge tone={STAGE_TONE[r.stage]}>
                            {STAGE_LABEL[r.stage]}
                          </StatusBadge>
                        )}
                        {r.adminRole && <StatusBadge tone="info">{r.adminRole}</StatusBadge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && (
            <p
              data-testid="directory-empty"
              className="px-4 py-6 text-center text-sm text-muted-foreground"
            >
              {query || department || status || unit
                ? "Nobody matches. Clear the search or a filter."
                : "Nobody here yet."}
            </p>
          )}
          <p className="border-t border-border px-4 py-3 text-caption text-muted-foreground">
            Deactivated people stay in the directory for the record, but cannot sign in.
          </p>
        </section>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  testId,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{`Any ${label.toLowerCase()}`}</option>
        {children}
      </select>
    </label>
  );
}

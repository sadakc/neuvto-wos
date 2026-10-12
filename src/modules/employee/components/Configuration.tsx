/**
 * Configuration (bundle §7.8, E9). Five sections, two panes: the section list
 * beside the content on a wide screen, above it on a narrow one.
 *
 *   01 Fields and visibility   the catalogue: every source column and its home
 *   02 Deployment units        and designations: the managed lists (rule 3)
 *   03 Record rules            what the record enforces, stated plainly
 *   04 Onboarding checklist    the company's due windows and mandatory items
 *   05 Access and admin roles  who may do what, and where to change it
 *
 * What is NOT a setting here, on purpose: who sees which field. That is §5,
 * enforced by employee_card(). A switch that could loosen it would be the leak.
 */

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isAppError } from "@/platform/errors";
import { cn } from "@/lib/utils";
import { UNIT_TYPE_LABEL } from "../contracts";
import { FIELD_CATALOGUE } from "../fieldCatalogue";
import {
  listAllDesignations,
  listOnboardingItems,
  listUnits,
  saveDesignation,
  saveOnboardingItem,
  saveUnit,
  setDesignationStatus,
  setUnitStatus,
  type DesignationRow,
  type OnboardingItem,
  type UnitRow,
} from "../handlers";
import { Panel } from "./parts";

const SECTIONS = [
  ["fields", "01 Fields and visibility"],
  ["units", "02 Deployment units"],
  ["rules", "03 Record rules"],
  ["onboarding", "04 Onboarding checklist"],
  ["access", "05 Access and admin roles"],
] as const;
type Section = (typeof SECTIONS)[number][0];

const input = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const th =
  "px-3 py-2 text-left text-table-header font-semibold tracking-table-header whitespace-nowrap text-muted-foreground uppercase";
const errorText = (e: unknown, fallback: string) => (isAppError(e) ? e.message : fallback);

export default function Configuration() {
  const [section, setSection] = useState<Section>("fields");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Configuration</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          The lists the record is built from, and the rules it keeps.
        </p>
      </div>
      <div className="grid gap-4 @min-[1000px]/app:grid-cols-[15rem_1fr]">
        <nav aria-label="Configuration sections" className="min-w-0">
          <ul className="flex gap-1 overflow-x-auto @min-[1000px]/app:flex-col">
            {SECTIONS.map(([key, label]) => (
              <li key={key} className="shrink-0">
                <button
                  type="button"
                  aria-current={section === key ? "page" : undefined}
                  data-testid={`config-${key}`}
                  onClick={() => setSection(key)}
                  className={cn(
                    "h-11 w-full rounded-md px-3 text-left text-sm whitespace-nowrap",
                    section === key
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-foreground-secondary hover:bg-secondary",
                  )}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {section === "fields" && <FieldsSection />}
          {section === "units" && <UnitsSection />}
          {section === "rules" && <RulesSection />}
          {section === "onboarding" && <OnboardingSection />}
          {section === "access" && <AccessSection />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ 01

function FieldsSection() {
  return (
    <Panel
      title="Fields and visibility"
      aside={`${FIELD_CATALOGUE.length} fields`}
      footer="Fields marked new do not exist in the master sheet. They were added because the sheet works around their absence: one mobile column where two numbers are needed, a single address cell that gets overwritten, and Son 1 and Son 2 columns that cannot hold a third. Who sees each field is enforced by the record itself and is not a setting."
    >
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[60rem] text-table-cell" data-testid="field-catalogue">
          <thead>
            <tr className="border-b border-border">
              {[
                "Group",
                "Field",
                "Master sheet column",
                "Required",
                "Employee can edit",
                "Visible to",
                "In exports",
                "In Neuvto",
              ].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELD_CATALOGUE.map((c) => (
              <tr key={`${c.group}-${c.field}`} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted-foreground">{c.group}</td>
                <td className={cn("px-3 py-2", c.sheet === "new" && "font-medium text-primary")}>
                  {c.field}
                </td>
                <td className="px-3 py-2 font-mono text-caption">
                  {c.sheet === "new" ? "new" : c.sheet.join(", ")}
                </td>
                <td className="px-3 py-2">{c.required}</td>
                <td className="px-3 py-2">{c.employeeCanEdit}</td>
                <td className="px-3 py-2">{c.visibleTo}</td>
                <td className="px-3 py-2">{c.inExports}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {c.home === "Card header" ? c.home : `${c.home.tab} › ${c.home.panel}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════ 02

function UnitsSection() {
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [designations, setDesignations] = useState<DesignationRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<UnitRow | "new" | null>(null);

  async function load() {
    try {
      const [u, d] = await Promise.all([listUnits(), listAllDesignations()]);
      setUnits(u);
      setDesignations(d);
    } catch (e) {
      setError(errorText(e, "The lists didn't load."));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(u: UnitRow) {
    setError("");
    try {
      await setUnitStatus(u.id, u.status === "active" ? "retired" : "active");
      await load();
    } catch (e) {
      setError(errorText(e, "That couldn't be changed."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          data-testid="units-error"
          className="rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Panel
        title="Deployment units"
        aside={
          <button
            type="button"
            data-testid="add-unit"
            onClick={() => setEditing("new")}
            className="text-sm font-medium text-primary hover:underline"
          >
            Add a unit
          </button>
        }
        footer="A unit is never deleted once anybody has been posted to it. Retiring it hides it from the Move dialog and leaves past postings readable. Renaming changes the label everywhere, because postings point at the unit, not its name."
      >
        {units === null ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : units.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No units yet. Add the first one; every posting picks from this list.
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-table-cell" data-testid="units-table">
              <thead>
                <tr className="border-b border-border">
                  {["Unit", "Type", "Client", "Location", "Posted now", "Ever", "Status", ""].map(
                    (h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr
                    key={u.id}
                    data-testid="unit-row"
                    className={cn(
                      "border-b border-border last:border-0",
                      u.status === "retired" && "text-muted-foreground",
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2">{UNIT_TYPE_LABEL[u.unitType] ?? u.unitType}</td>
                    <td className="px-3 py-2">{u.clientName ?? "—"}</td>
                    <td className="px-3 py-2">
                      {[u.location, u.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">{u.postedNow}</td>
                    <td className="px-3 py-2">{u.postingsEver}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={u.status === "active" ? "success" : "neutral"}>
                        {u.status === "active" ? "Active" : "Retired"}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditing(u)}
                        className="mr-3 text-sm text-primary hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        data-testid="toggle-unit"
                        onClick={() => void toggle(u)}
                        disabled={u.status === "active" && u.postedNow > 0}
                        title={
                          u.status === "active" && u.postedNow > 0
                            ? "People are posted here. Move them first."
                            : undefined
                        }
                        className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                      >
                        {u.status === "active" ? "Retire" : "Bring back"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="What a unit controls">
        <p className="text-sm text-foreground-secondary">
          Every posting, so the muster roll and a client invoice read the unit that was current on
          the day. Whether police verification is required there, and whether it is billable.
          Working calendars, shift patterns and attendance capture per unit arrive with Attendance.
        </p>
      </Panel>

      <DesignationsPanel designations={designations} onChanged={load} />

      {editing && (
        <UnitDialog
          unit={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function UnitDialog({
  unit,
  onClose,
  onSaved,
}: {
  unit: UnitRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [v, setV] = useState({
    name: unit?.name ?? "",
    unitType: unit?.unitType ?? "own_establishment",
    clientName: unit?.clientName ?? "",
    location: unit?.location ?? "",
    state: unit?.state ?? "",
    requiresPoliceVerification: unit?.requiresPoliceVerification ?? false,
    isBillable: unit?.isBillable ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await saveUnit(unit?.id ?? null, {
        ...v,
        clientName: v.unitType === "client_site" ? v.clientName : "",
      } as never);
      await onSaved();
    } catch (err) {
      setError(errorText(err, "The unit couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{unit ? `Edit ${unit.name}` : "Add a unit"}</DialogTitle>
          {unit && (
            <DialogDescription data-testid="unit-edit-warning">
              {unit.postedNow} {unit.postedNow === 1 ? "person is" : "people are"} posted here now,
              and {unit.postingsEver}{" "}
              {unit.postingsEver === 1 ? "posting points" : "postings point"} at it in all. Renaming
              changes the label on every one of them.
            </DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <label className="text-sm">
            <span className="block font-medium">Name</span>
            <input
              required
              data-testid="unit-name"
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </label>
          <label className="text-sm">
            <span className="block font-medium">Type</span>
            <select
              data-testid="unit-type"
              value={v.unitType}
              onChange={(e) => setV({ ...v, unitType: e.target.value })}
              className={`mt-1 ${input}`}
            >
              <option value="own_establishment">Own establishment</option>
              <option value="client_site">Client site</option>
            </select>
          </label>
          {v.unitType === "client_site" && (
            <label className="text-sm">
              <span className="block font-medium">Client</span>
              <input
                required
                data-testid="unit-client"
                value={v.clientName}
                onChange={(e) => setV({ ...v, clientName: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
          )}
          <div className="grid gap-3 @min-[480px]/app:grid-cols-2">
            <label className="text-sm">
              <span className="block font-medium">Location</span>
              <input
                value={v.location}
                onChange={(e) => setV({ ...v, location: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium">State</span>
              <input
                value={v.state}
                onChange={(e) => setV({ ...v, state: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.requiresPoliceVerification}
              onChange={(e) => setV({ ...v, requiresPoliceVerification: e.target.checked })}
              className="size-4"
            />
            Requires police verification
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.isBillable}
              onChange={(e) => setV({ ...v, isBillable: e.target.checked })}
              className="size-4"
            />
            Billable to the client
          </label>
          {error && (
            <p role="alert" data-testid="unit-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            data-testid="unit-save"
            className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
          >
            {busy ? "Saving…" : unit ? "Save changes" : "Add unit"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DesignationsPanel({
  designations,
  onChanged,
}: {
  designations: DesignationRow[] | null;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await saveDesignation(null, { name, grade });
      setName("");
      setGrade("");
      await onChanged();
    } catch (err) {
      setError(errorText(err, "The designation couldn't be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Designations"
      footer="Retiring a designation keeps it on everybody who holds it and stops it being given to anybody new."
    >
      {designations === null ? (
        <div className="h-12 animate-pulse rounded bg-muted" />
      ) : (
        <ul className="flex flex-col gap-2 text-sm" data-testid="designations">
          {designations.map((d) => (
            <li
              key={d.id}
              className={cn(
                "flex flex-wrap items-center gap-2",
                d.status === "retired" && "text-muted-foreground",
              )}
            >
              <span className="font-medium">{d.name}</span>
              {d.grade && <span className="text-caption">({d.grade})</span>}
              {d.status === "retired" && <StatusBadge tone="neutral">Retired</StatusBadge>}
              <button
                type="button"
                onClick={async () => {
                  setError("");
                  try {
                    await setDesignationStatus(d.id, d.status === "active" ? "retired" : "active");
                    await onChanged();
                  } catch (err) {
                    setError(errorText(err, "That couldn't be changed."));
                  }
                }}
                className="ml-auto text-sm text-primary hover:underline"
              >
                {d.status === "active" ? "Retire" : "Bring back"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 grid gap-2 @min-[560px]/app:grid-cols-[1fr_8rem_auto]">
        <input
          required
          aria-label="New designation"
          placeholder="Security Supervisor"
          data-testid="designation-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={input}
        />
        <input
          aria-label="Grade"
          placeholder="Grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className={input}
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          data-testid="designation-add"
          className="h-11 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-45"
        >
          Add
        </button>
      </form>
      {error && (
        <p role="alert" data-testid="designation-error" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════ 03

const CORRECTIONS: [string, string, boolean][] = [
  [
    "Types a new present address",
    "Old row closed the day before, new row opened, both kept",
    false,
  ],
  [
    "Picks a different deployed unit",
    "Open posting closed, new posting opened, with its order reference",
    false,
  ],
  [
    "Fixes a typo in an archived address",
    "Refused. Archived rows are read only; the record keeps what was true then",
    true,
  ],
  [
    "Removes a son added by mistake",
    "Row removed, because a family row carries no history of its own. The change is in the audit log",
    false,
  ],
  [
    "Changes a nominee",
    "The whole nomination is superseded; the old one stays, because a claim is settled against it",
    false,
  ],
  [
    "Reveals an Aadhaar number",
    "Nothing on the record changes. The look is written to the reveal log with its reason",
    false,
  ],
];

function RulesSection() {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="The three rules the record keeps">
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>
            <strong>Repeating things repeat without a limit.</strong> Family, nominees and previous
            organisations are lists. There is no Son 1 and Son 2, so a third son is a third row.
          </li>
          <li>
            <strong>History is closed, never overwritten.</strong> Addresses, postings and
            nominations end with a date and stay; the database refuses an edit to a closed row and
            any delete, for everybody.
          </li>
          <li>
            <strong>Anything a report groups by comes from a managed list.</strong> Units and
            designations are picked, never typed, so the muster roll and the invoice always agree.
          </li>
        </ol>
      </Panel>
      <Panel title="What happens to a correction">
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-table-cell" data-testid="corrections">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  An Admin does this
                </th>
                <th scope="col" className={th}>
                  The record does this
                </th>
              </tr>
            </thead>
            <tbody>
              {CORRECTIONS.map(([act, result, refused]) => (
                <tr key={act} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{act}</td>
                  <td className={cn("px-3 py-2", refused && "font-medium text-destructive")}>
                    {result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ 04

function OnboardingSection() {
  const [items, setItems] = useState<OnboardingItem[] | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await listOnboardingItems());
    } catch (e) {
      setError(errorText(e, "The checklist didn't load."));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(item: OnboardingItem, due: number, mandatory: boolean) {
    setError("");
    setSaved(null);
    try {
      await saveOnboardingItem(item.key, due, mandatory);
      setSaved(item.key);
      await load();
    } catch (e) {
      setError(errorText(e, "That couldn't be saved."));
    }
  }

  return (
    <Panel
      title="Onboarding checklist"
      footer="A mandatory item a record lacks is listed against it on Add Employee, and marked overdue once its window from the joining date has passed. Reminders and escalation arrive with scheduled notifications for this module."
    >
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {items === null ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : (
        <ul className="divide-y divide-border" data-testid="onboarding-items">
          {items.map((i) => (
            <OnboardingRow key={i.key} item={i} saved={saved === i.key} onSave={save} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function OnboardingRow({
  item,
  saved,
  onSave,
}: {
  item: OnboardingItem;
  saved: boolean;
  onSave: (i: OnboardingItem, due: number, mandatory: boolean) => Promise<void>;
}) {
  const [due, setDue] = useState(String(item.dueWithinDays));
  const [mandatory, setMandatory] = useState(item.mandatory);
  const changed = Number(due) !== item.dueWithinDays || mandatory !== item.mandatory;
  const valid = /^\d{1,3}$/.test(due) && Number(due) <= 365;
  return (
    <li data-testid="onboarding-item" className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1">{item.label}</span>
      <label className="flex items-center gap-1.5">
        <span className="text-caption text-muted-foreground">within</span>
        <input
          aria-label={`${item.label}: days`}
          inputMode="numeric"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="h-10 w-16 rounded-md border border-input bg-background px-2 text-sm"
        />
        <span className="text-caption text-muted-foreground">days</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          aria-label={`${item.label}: mandatory`}
          checked={mandatory}
          onChange={(e) => setMandatory(e.target.checked)}
          className="size-4"
        />
        Mandatory
      </label>
      <button
        type="button"
        disabled={!changed || !valid}
        onClick={() => void onSave(item, Number(due), mandatory)}
        className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-40"
      >
        Save
      </button>
      {saved && (
        <span role="status" className="text-caption text-success">
          Saved
        </span>
      )}
    </li>
  );
}

// ═══════════════════════════════════════════════════════════ 05

const ROLE_TABLE: [string, string, string][] = [
  ["Employee", "Everybody", "Their own card; asks for corrections"],
  [
    "Approver",
    "An Admin gives Manager, Supervisor or Coordinator",
    "Their reports' leave, and whom to call in an emergency",
  ],
  ["Admin", "A Super Admin", "Writes the record; reads every card except bank and restricted data"],
  ["Payroll role", "A Super Admin", "UAN, EPF and ESIC in full; reveals and writes bank accounts"],
  [
    "Statutory role",
    "A Super Admin",
    "Reveals Aadhaar, PAN and restricted data, with a reason that is logged",
  ],
  [
    "Super Admin",
    "Neuvto at provisioning, then another Super Admin",
    "Everything an Admin does; makes Admins; imports records",
  ],
];

function AccessSection() {
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Access and admin roles"
        footer="Roles are given and taken on People, under Change access."
      >
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-table-cell" data-testid="roles">
            <thead>
              <tr className="border-b border-border">
                {["Role", "Given by", "What it can do here"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_TABLE.map(([role, by, what]) => (
                <tr key={role} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{role}</td>
                  <td className="px-3 py-2">{by}</td>
                  <td className="px-3 py-2">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Rules that are always on">
        <ul className="space-y-3 text-sm">
          <li>
            <strong>The Statutory role is separate from Admin.</strong> Being the HR admin should
            not mean being able to read 248 Aadhaar numbers. Enforced by the database; not a switch.
          </li>
          <li>
            <strong>Every reveal is logged</strong>, with who, whose, which fields, why and when,
            and the person can see who looked.
          </li>
          <li>
            <strong>Only a Super Admin makes administrators</strong>, and a company always keeps at
            least one Super Admin.
          </li>
          <li className="text-muted-foreground">
            Logging every view of a card, not only reveals, is not built yet.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

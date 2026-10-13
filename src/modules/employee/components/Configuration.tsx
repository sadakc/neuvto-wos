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
 * What IS, since D107: which fields are required, and which the person may
 * change on their own card. Only a Super Admin sets them.
 */

import { ChevronDown, ChevronUp, Lock } from "lucide-react";
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
import {
  UNIT_TYPE_LABEL,
  type CalendarRow,
  type OnboardingSettings,
  type ShiftRow,
} from "../contracts";
import { describeShift, describeWeek, formatDate } from "../format";
import { FIELD_CATALOGUE, type CatalogueField } from "../fieldCatalogue";
import { LOCK_REASON, type FieldSetting } from "../fieldSettings";
import { HOME_STATE, STATES } from "../indiaPlaces";
import {
  listCalendars,
  listShifts,
  getOnboardingSettings,
  listAllDesignations,
  listOnboardingItems,
  saveOnboardingSettings,
  listUnits,
  listFieldSettings,
  rankDesignations,
  saveFieldSetting,
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
import { CalendarsAndShifts } from "./CalendarsAndShifts";

const SECTIONS = [
  ["fields", "01 Fields and visibility"],
  ["units", "02 Deployment units"],
  ["rules", "03 Record rules"],
  ["onboarding", "04 Onboarding checklist"],
  ["access", "05 Access and admin roles"],
  ["calendars", "06 Calendars and shifts"],
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
          {section === "calendars" && <CalendarsAndShifts />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ 01

function FieldsSection() {
  const [settings, setSettings] = useState<Map<string, FieldSetting> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listFieldSettings()
      .then((rows) => setSettings(new Map(rows.map((r) => [r.key, r]))))
      .catch((e) => setError(errorText(e, "The field settings didn't load.")));
  }, []);

  const canChange = settings ? [...settings.values()].some((s) => s.canChange) : false;

  async function change(s: FieldSetting, which: "required" | "employeeCanUpdate", value: boolean) {
    setError("");
    // Shown at once; put back if the database says no.
    setSettings((m) => new Map(m).set(s.key, { ...s, [which]: value }));
    try {
      await saveFieldSetting(s.key, which, value);
    } catch (e) {
      setSettings((m) => new Map(m).set(s.key, s));
      setError(errorText(e, "That couldn't be saved."));
    }
  }

  return (
    <Panel
      title="Fields and visibility"
      aside={`${FIELD_CATALOGUE.length} fields`}
      footer="Fields marked new do not exist in the master sheet. They were added because the sheet works around their absence: one mobile column where two numbers are needed, a single address cell that gets overwritten, and Son 1 and Son 2 columns that cannot hold a third. Columns the sheet repeats (Father name, Husband name) are kept once. Who sees each field is enforced by the record itself and is not a setting."
    >
      <p className="mb-3 text-sm text-foreground-secondary" data-testid="field-settings-note">
        <strong className="font-semibold text-foreground">Required</strong> means a save that leaves
        the field empty is refused.{" "}
        <strong className="font-semibold text-foreground">Employees can update</strong> means the
        person changes it on their own card, saved straight away with no approval; anything else
        they ask for with Request a change.{" "}
        {settings &&
          (canChange
            ? "Change either here; it applies to everybody in the company at once."
            : "Only a Super Admin can change these.")}
      </p>
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[60rem] text-table-cell" data-testid="field-catalogue">
          <thead>
            <tr className="border-b border-border">
              {[
                "Group",
                "Field",
                "Master sheet column",
                "Required",
                "Employees can update",
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
            {FIELD_CATALOGUE.map((c) => {
              const s = settings?.get(c.key);
              return (
                <tr key={`${c.group}-${c.field}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{c.group}</td>
                  <td className={cn("px-3 py-2", c.sheet === "new" && "font-medium text-primary")}>
                    {c.field}
                  </td>
                  <td className="px-3 py-2 font-mono text-caption">
                    {c.sheet === "new" ? "new" : c.sheet.join(", ")}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <SettingCell
                      field={c}
                      setting={s}
                      loaded={settings !== null}
                      which="required"
                      onChange={change}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <SettingCell
                      field={c}
                      setting={s}
                      loaded={settings !== null}
                      which="employeeCanUpdate"
                      onChange={change}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.visibleTo}</td>
                  <td className="px-3 py-2">{c.inExports}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.home === "Card header" ? c.home : `${c.home.tab} › ${c.home.panel}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const WHICH_LABEL = { required: "Required", employeeCanUpdate: "Employees can update" } as const;

/**
 * One answer: a Yes/No choice for a Super Admin, the answer for anybody else,
 * and for a fixed one the answer with why it is fixed. A worked-out field
 * keeps its words (Derived, Auto), since a Yes or No would say nothing.
 */
function SettingCell({
  field,
  setting,
  loaded,
  which,
  onChange,
}: {
  field: CatalogueField;
  setting: FieldSetting | undefined;
  loaded: boolean;
  which: "required" | "employeeCanUpdate";
  onChange: (s: FieldSetting, which: "required" | "employeeCanUpdate", value: boolean) => void;
}) {
  const words = which === "required" ? field.required : field.employeeCanEdit;
  if (!loaded) return <span className="text-muted-foreground">{words}</span>;
  if (!setting) {
    return (
      <span data-testid="setting-missing" className="text-muted-foreground">
        —
      </span>
    );
  }
  const value = setting[which];
  const lock = which === "required" ? setting.requiredLock : setting.updateLock;
  if (lock) {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {lock === "derived" && words !== "Yes" && words !== "No" ? words : value ? "Yes" : "No"}
          <Lock aria-hidden className="size-3 text-muted-foreground" />
        </span>
        <span className="min-w-[10rem] text-caption text-muted-foreground">
          {LOCK_REASON[lock]}
        </span>
      </span>
    );
  }
  if (!setting.canChange) return <span>{value ? "Yes" : "No"}</span>;
  return (
    <select
      aria-label={`${WHICH_LABEL[which]}: ${setting.label}`}
      data-testid={`setting-${which}-${setting.key}`}
      value={value ? "yes" : "no"}
      onChange={(e) => onChange(setting, which, e.target.value === "yes")}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
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
          the day. The working calendar leave is counted on there, and the shift people posted there
          work unless they have their own (Calendars and shifts). Whether police verification is
          required there, and whether it is billable. Attendance capture arrives with Attendance.
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
    // A new unit starts in the home state (D106), like an address.
    state: unit ? (unit.state ?? "") : HOME_STATE,
    requiresPoliceVerification: unit?.requiresPoliceVerification ?? false,
    isBillable: unit?.isBillable ?? false,
    // D102: "" is the Company calendar, or no default shift.
    workingCalendarId: unit?.workingCalendarId ?? "",
    defaultShiftId: unit?.defaultShiftId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);

  useEffect(() => {
    listCalendars()
      .then(setCalendars)
      .catch(() => setCalendars([]));
    listShifts()
      .then(setShifts)
      .catch(() => setShifts([]));
  }, []);
  // Only what is in use, plus whatever this unit already has.
  const calendarChoices = calendars.filter(
    (c) => !c.isDefault && (c.status === "active" || c.id === v.workingCalendarId),
  );
  const company = calendars.find((c) => c.isDefault);
  const shiftChoices = shifts.filter((s) => s.status === "active" || s.id === v.defaultShiftId);

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
              {/* D106: every state is chosen from the list, here as on the card. */}
              <select
                aria-label="State"
                data-testid="unit-state"
                value={v.state}
                onChange={(e) => setV({ ...v, state: e.target.value })}
                className={`mt-1 ${input}`}
              >
                <option value="">Not recorded</option>
                {/* A state typed before the list existed stays shown as it is. */}
                {v.state && !STATES.includes(v.state) && <option value={v.state}>{v.state}</option>}
                {STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 @min-[480px]/app:grid-cols-2">
            <label className="text-sm">
              <span className="block font-medium">Working calendar</span>
              <select
                aria-label="Working calendar"
                value={v.workingCalendarId}
                onChange={(e) => setV({ ...v, workingCalendarId: e.target.value })}
                className={`mt-1 ${input}`}
              >
                <option value="">
                  Company calendar{company ? ` (${describeWeek(company.weeklyOff)})` : ""}
                </option>
                {calendarChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({describeWeek(c.weeklyOff)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block font-medium">Default shift</span>
              <select
                aria-label="Default shift"
                value={v.defaultShiftId}
                onChange={(e) => setV({ ...v, defaultShiftId: e.target.value })}
                className={`mt-1 ${input}`}
              >
                <option value="">No default shift</option>
                {shiftChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({describeShift(s)})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {unit && v.workingCalendarId !== (unit.workingCalendarId ?? "") && (
            <p className="text-caption text-muted-foreground" data-testid="unit-calendar-warning">
              Leave asked for from now on by the {unit.postedNow} posted here is counted on the new
              calendar. Leave already asked for keeps its count.
            </p>
          )}
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

/**
 * The company's designations (D106): added, edited and retired here, and put
 * in the company's order, most senior first. Every list a designation is
 * chosen from reads in this order, so the dropdown is the hierarchy.
 */
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
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", grade: "" });

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (
      await run(() => saveDesignation(null, { name, grade }), "The designation couldn't be added.")
    ) {
      setName("");
      setGrade("");
    }
  }

  async function saveEdit(id: string) {
    if (!draft.name.trim()) {
      setError("A designation needs a name.");
      return;
    }
    if (
      await run(
        () => saveDesignation(id, { name: draft.name.trim(), grade: draft.grade.trim() }),
        "The designation couldn't be saved.",
      )
    ) {
      setEditing(null);
    }
  }

  /** Swaps a designation with its neighbour, and sends the whole list in its new order. */
  function move(index: number, by: -1 | 1) {
    if (!designations) return;
    const ids = designations.map((d) => d.id);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void run(() => rankDesignations(ids), "The order couldn't be saved.");
  }

  return (
    <Panel
      title="Designations"
      footer="The order here is the order in every designation list, most senior at the top. Retiring a designation keeps it on everybody who holds it and stops it being given to anybody new."
    >
      {designations === null ? (
        <div className="h-12 animate-pulse rounded bg-muted" />
      ) : (
        <ol className="flex flex-col gap-1 text-sm" data-testid="designations">
          {designations.map((d, i) => (
            <li
              key={d.id}
              data-testid="designation-row"
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-md border border-transparent px-1 py-1",
                d.status === "retired" && "text-muted-foreground",
                editing === d.id && "border-border bg-muted/40",
              )}
            >
              <span className="w-6 shrink-0 text-right font-mono text-caption text-muted-foreground">
                {i + 1}
              </span>
              {editing === d.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit(d.id);
                  }}
                >
                  <input
                    aria-label={`Name of ${d.name}`}
                    value={draft.name}
                    autoFocus
                    maxLength={100}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className={cn(input, "min-w-40 flex-1")}
                  />
                  <input
                    aria-label={`Grade of ${d.name}`}
                    placeholder="Grade"
                    value={draft.grade}
                    maxLength={30}
                    onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
                    className={cn(input, "w-28")}
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="h-11 rounded-md border border-border px-3 text-sm"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="font-medium">{d.name}</span>
                  {d.grade && <span className="text-caption">({d.grade})</span>}
                  {d.status === "retired" && <StatusBadge tone="neutral">Retired</StatusBadge>}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${d.name} up`}
                      title="Move up"
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${d.name} down`}
                      title="Move down"
                      disabled={busy || i === designations.length - 1}
                      onClick={() => move(i, 1)}
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${d.name}`}
                      onClick={() => {
                        setError("");
                        setDraft({ name: d.name, grade: d.grade ?? "" });
                        setEditing(d.id);
                      }}
                      className="inline-flex min-h-9 items-center px-2 text-sm text-primary hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          () =>
                            setDesignationStatus(
                              d.id,
                              d.status === "active" ? "retired" : "active",
                            ),
                          "That couldn't be changed.",
                        )
                      }
                      className="inline-flex min-h-9 items-center px-2 text-sm text-primary hover:underline"
                    >
                      {d.status === "active" ? "Retire" : "Bring back"}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
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
      <p className="mt-1 text-caption text-muted-foreground">
        A new designation joins at the bottom.
      </p>
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
      footer="A mandatory item a record lacks is listed against it on Add Employee, and marked overdue once its window from the joining date has passed. Deactivated records are not chased."
    >
      <OnboardingReminders />
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

/**
 * D99. How often the Employee Admins are told which records have mandatory
 * items past due, and after how many days past due the Super Admins are told.
 * One email a company, sent each morning the cadence comes round.
 */
function OnboardingReminders() {
  const [s, setS] = useState<OnboardingSettings | null>(null);
  const [every, setEvery] = useState("");
  const [after, setAfter] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const v = await getOnboardingSettings();
      setS(v);
      setEvery(String(v.remindEveryDays));
      setAfter(String(v.escalateAfterDays));
    } catch (e) {
      setError(errorText(e, "The reminder settings didn't load."));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const valid =
    /^\d{1,2}$/.test(every) &&
    Number(every) <= 30 &&
    /^\d{1,2}$/.test(after) &&
    Number(after) <= 90;
  const changed =
    !!s && (Number(every) !== s.remindEveryDays || Number(after) !== s.escalateAfterDays);

  async function save() {
    setError("");
    setSaved(false);
    try {
      await saveOnboardingSettings(Number(every), Number(after));
      setSaved(true);
      await load();
    } catch (e) {
      setError(errorText(e, "That couldn't be saved."));
    }
  }

  const last = (x: OnboardingSettings["lastReminder"], none: string, what: string) =>
    x
      ? `Last ${what} ${formatDate(x.sentAt)}, ${x.people} ${x.people === 1 ? "person" : "people"}.`
      : none;

  return (
    <div
      data-testid="onboarding-reminders"
      className="mb-4 flex flex-col gap-3 rounded-lg border border-border p-3 text-sm"
    >
      {s === null && !error ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                Remind the Employee Admins every (days)
              </span>
              <input
                aria-label="Remind the Employee Admins every (days)"
                inputMode="numeric"
                value={every}
                onChange={(e) => setEvery(e.target.value)}
                className="h-10 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                Tell the Super Admins after (days past due)
              </span>
              <input
                aria-label="Tell the Super Admins after (days past due)"
                inputMode="numeric"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                className="h-10 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={!changed || !valid}
              onClick={() => void save()}
              className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-40"
            >
              Save reminders
            </button>
            {saved && (
              <span role="status" className="text-caption text-success">
                Saved
              </span>
            )}
          </div>
          <p className="text-caption text-muted-foreground">
            One email each morning the reminder comes round, naming every record with a mandatory
            item past due. Up to 30 days between reminders, and up to 90 days past due before the
            Super Admins are told; 0 switches it off. With reminders off, the Super Admins are not
            told either.
          </p>
          {s && (
            <p className="text-caption text-muted-foreground">
              {last(s.lastReminder, "No reminder sent yet.", "reminder")}{" "}
              {last(s.lastEscalation, "No escalation sent yet.", "escalation")}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
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
      {/* A line of its own on a phone; beside its controls when there is room. */}
      <span className="min-w-0 basis-full @min-[560px]/app:basis-0 @min-[560px]/app:flex-1">
        {item.label}
      </span>
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
          <li>
            <strong>Every look at somebody else&apos;s record is logged too</strong>, not only
            reveals: who opened it and when, kept three years. The person and a Super Admin can see
            who looked.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

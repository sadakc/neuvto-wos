/**
 * Adding people and letting them go (E8, bundle §7.6–7.7).
 *
 * ADD EMPLOYEE, AS BUILT. The bundle draws one long eight-section form. Here
 * the page starts the record (sections 01 and 02: who they are, where they
 * sit) and the record's own card does the rest, with the editors it already
 * has for deployment, address, family, nominees, statutory and previous
 * organisations. One set of editors means one set of rules: a second copy of
 * the address form here would be the one that forgot to close the old row.
 * Recorded as a deliberate difference in NEUVTO_EMPLOYEE_MASTER §7.
 *
 * An incomplete record can be invited (§7.6). What it is missing is listed
 * against it in "People you have added" until somebody fills it in.
 */

import { useNavigate } from "@tanstack/react-router";
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
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  STAGE_LABEL,
  type AdminOverview,
  type DeactivationPreview,
  type DeactivationResult,
  type EmployeeCard,
} from "../contracts";
import { STAGE_TONE } from "../status";
import {
  createDraft,
  deactivateEmployee,
  getAdminOverview,
  getDeactivationPreview,
  listDesignations,
  sendInvite,
  updateDraft,
  updateEmployee,
  type Option,
} from "../handlers";
import { formatDate, todayIso } from "../format";
import { AddInline, FieldEditor, type AddChoice } from "./FieldEditor";
import { checkField, type FieldRule } from "../fieldRules";
import { addDepartmentChoice, addDesignationChoice, addManagerChoice } from "../positionLists";
import { PersonLink } from "./PersonLink";

const input =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm aria-invalid:border-destructive";
/** A select's "Add …" choice. */
const ADD = "__add__";
const eyebrow = "block text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase";

function errorText(err: unknown, fallback: string) {
  return isAppError(err) ? err.message : fallback;
}

// ═══════════════════════════════════════════════════════════ Add Employee

export default function AddEmployee() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [designations, setDesignations] = useState<Option[]>([]);
  const [loadError, setLoadError] = useState("");
  const blank = {
    fullName: "",
    email: "",
    phone: "",
    joinedDate: todayIso(),
    departmentId: "",
    managerId: "",
    designationId: "",
    employmentType: "",
    employeeCode: "",
  };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState<"draft" | "invite" | null>(null);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Which select's "Add …" form is open, and what has been added while here.
  const [adding, setAdding] = useState<"designationId" | "departmentId" | "managerId" | null>(null);
  const [addedDepartments, setAddedDepartments] = useState<{ id: string; name: string }[]>([]);
  const [addedManagers, setAddedManagers] = useState<{ profileId: string; fullName: string }[]>([]);

  // D103: each typed field against its rule, said under the field.
  const RULES: [keyof typeof blank, FieldRule][] = [
    ["fullName", "name"],
    ["email", "email"],
    ["phone", "phone"],
    ["employeeCode", "employeeCode"],
  ];
  function problems(values: typeof blank) {
    const found: Record<string, string> = {};
    if (!values.fullName.trim()) found.fullName = "A name is required.";
    for (const [key, rule] of RULES) {
      const p = found[key] ?? checkField(rule, values[key]);
      if (p) found[key] = p;
    }
    return found;
  }
  function change(key: keyof typeof blank, value: string) {
    const next = { ...v, [key]: value };
    setV(next);
    if (fieldErrors[key] !== undefined) {
      const p = problems(next)[key];
      setFieldErrors((e) => {
        const n = { ...e };
        if (p) n[key] = p;
        else delete n[key];
        return n;
      });
    }
  }
  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span role="alert" id={`add-${key}-error`} className="mt-1 block text-sm text-destructive">
        {fieldErrors[key]}
      </span>
    ) : null;
  const invalid = (key: string) =>
    fieldErrors[key]
      ? { "aria-invalid": true as const, "aria-describedby": `add-${key}-error` }
      : {};
  function pick(key: "designationId" | "departmentId" | "managerId", value: string) {
    if (value === ADD) setAdding(key);
    else {
      setAdding(null);
      change(key, value);
    }
  }
  function addedInline(choice: AddChoice, key: "designationId" | "departmentId" | "managerId") {
    return (
      <AddInline
        choice={choice}
        onCancel={() => setAdding(null)}
        onAdded={(value, text) => {
          if (key === "designationId") setDesignations((d) => [...d, { id: value, name: text }]);
          if (key === "departmentId") setAddedDepartments((d) => [...d, { id: value, name: text }]);
          if (key === "managerId")
            setAddedManagers((m) => [...m, { profileId: value, fullName: text }]);
          setAdding(null);
          change(key, value);
        }}
      />
    );
  }

  async function load() {
    try {
      const [o, d] = await Promise.all([getAdminOverview(), listDesignations().catch(() => [])]);
      setOverview(o);
      setDesignations(d);
    } catch (e) {
      setLoadError(errorText(e, "This page didn't load."));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(andInvite: boolean) {
    setError("");
    const found = problems(v);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(andInvite ? "invite" : "draft");
    let id: string | null = null;
    try {
      id = await createDraft({
        fullName: v.fullName,
        email: v.email.trim() || null,
        phone: v.phone.trim() || null,
        joinedDate: v.joinedDate || null,
        departmentId: v.departmentId || null,
        managerId: v.managerId || null,
      });
      const record: Record<string, string> = {};
      if (v.designationId) record.designationId = v.designationId;
      if (v.employmentType) record.employmentType = v.employmentType;
      if (v.employeeCode.trim()) record.employeeCode = v.employeeCode.trim();
      if (Object.keys(record).length) await updateEmployee(id, record);
      if (andInvite) await sendInvite(id);
      void navigate({
        to: "/app/$",
        params: { _splat: "employee/directory/person" },
        search: { id } as never,
      });
    } catch (err) {
      // A record that was created and then refused its invitation still
      // exists, as a draft. Say so, rather than leaving the Admin to make a
      // second one.
      setError(
        errorText(err, "That couldn't be saved.") +
          (id ? " The record was saved as a draft; you'll find it below." : ""),
      );
      if (id) {
        setV(blank);
        void load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function invite(id: string) {
    setRowError(null);
    setInviting(id);
    try {
      await sendInvite(id);
      await load();
    } catch (err) {
      setRowError({ id, message: errorText(err, "The invitation couldn't be sent.") });
    } finally {
      setInviting(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Add Employee</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          Start the record here. It opens on their card when you save, where the rest of it
          (deployment, address, family, nominees, statutory numbers) is filled in. Somebody can be
          invited before the record is complete; what is missing stays listed below.
        </p>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 @min-[800px]/app:grid-cols-4" data-testid="add-tiles">
        {[
          ["Active", overview?.active],
          ["Invited, not yet signed in", overview?.invitedNotSignedIn],
          ["Deployed to client units", overview?.deployedToClientUnits],
          ["Missing statutory data", overview?.missingStatutory],
        ].map(([label, value]) => (
          <div
            key={label as string}
            className="rounded-xl border border-border bg-card px-4 py-3 shadow-card"
          >
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="text-stat font-semibold tracking-stat">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {overview && overview.missingStatutory > 0 && (
        <p className="text-caption text-muted-foreground">
          A record without a UAN, or without both Aadhaar and PAN, cannot be paid until it has them.
        </p>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
        className="rounded-xl border border-border bg-card p-4 shadow-card"
        data-testid="add-form"
      >
        <h2 className="text-card-title font-semibold tracking-card-title">
          01 Identity and contact
        </h2>
        <div className="mt-3 grid gap-3 @min-[640px]/app:grid-cols-2">
          <label className="min-w-0 text-sm">
            <span className={eyebrow}>Full name</span>
            <input
              required
              data-testid="add-name"
              maxLength={100}
              value={v.fullName}
              onChange={(e) => change("fullName", e.target.value)}
              {...invalid("fullName")}
              className={`mt-1 ${input}`}
            />
            {fieldError("fullName")}
          </label>
          <label className="min-w-0 text-sm">
            <span className={eyebrow}>Work email</span>
            <input
              type="email"
              data-testid="add-email"
              maxLength={200}
              value={v.email}
              onChange={(e) => change("email", e.target.value)}
              {...invalid("email")}
              className={`mt-1 ${input}`}
            />
            {fieldError("email")}
            <span className="mt-1 block text-caption text-muted-foreground">
              Where the invitation goes. Can be added later.
            </span>
          </label>
          <label className="min-w-0 text-sm">
            <span className={eyebrow}>Mobile</span>
            <input
              type="tel"
              data-testid="add-phone"
              maxLength={20}
              value={v.phone}
              onChange={(e) => change("phone", e.target.value)}
              {...invalid("phone")}
              className={`mt-1 ${input}`}
            />
            {fieldError("phone")}
          </label>
        </div>

        <h2 className="mt-5 text-card-title font-semibold tracking-card-title">02 Employment</h2>
        <div className="mt-3 grid gap-3 @min-[640px]/app:grid-cols-2">
          <label className="min-w-0 text-sm">
            <span className={eyebrow}>Employee ID</span>
            <input
              data-testid="add-code"
              maxLength={30}
              value={v.employeeCode}
              onChange={(e) => change("employeeCode", e.target.value)}
              {...invalid("employeeCode")}
              className={`mt-1 ${input} font-mono`}
            />
            {fieldError("employeeCode")}
          </label>
          <label className="min-w-0 text-sm">
            <span className={eyebrow}>Date of joining</span>
            <input
              type="date"
              value={v.joinedDate}
              onChange={(e) => setV({ ...v, joinedDate: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </label>
          <div className="min-w-0 text-sm">
            <label className="block">
              <span className={eyebrow}>Designation</span>
              <select
                data-testid="add-designation"
                value={v.designationId}
                onChange={(e) => pick("designationId", e.target.value)}
                className={`mt-1 ${input}`}
              >
                <option value="">None</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.detail ? `${d.name} (${d.detail})` : d.name}
                  </option>
                ))}
                <option value={ADD}>{addDesignationChoice.label}</option>
              </select>
            </label>
            {adding === "designationId" && addedInline(addDesignationChoice, "designationId")}
          </div>
          <div className="min-w-0 text-sm">
            <label className="block">
              <span className={eyebrow}>Department</span>
              <select
                data-testid="add-department"
                value={v.departmentId}
                onChange={(e) => pick("departmentId", e.target.value)}
                className={`mt-1 ${input}`}
              >
                <option value="">None</option>
                {[...(overview?.departments ?? []), ...addedDepartments]
                  .filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                <option value={ADD}>{addDepartmentChoice.label}</option>
              </select>
            </label>
            {adding === "departmentId" && addedInline(addDepartmentChoice, "departmentId")}
          </div>
          <div className="min-w-0 text-sm">
            <label className="block">
              <span className={eyebrow}>Reports to</span>
              <select
                data-testid="add-manager"
                value={v.managerId}
                onChange={(e) => pick("managerId", e.target.value)}
                className={`mt-1 ${input}`}
              >
                <option value="">None</option>
                {[...(overview?.managers ?? []), ...addedManagers]
                  .filter((m, i, all) => all.findIndex((x) => x.profileId === m.profileId) === i)
                  .map((m) => (
                    <option key={m.profileId} value={m.profileId}>
                      {m.fullName}
                    </option>
                  ))}
                <option value={ADD}>{addManagerChoice.label}</option>
              </select>
            </label>
            {adding === "managerId" && addedInline(addManagerChoice, "managerId")}
          </div>
          <label className="min-w-0 text-sm">
            <span className={eyebrow}>Employment type</span>
            <select
              data-testid="add-employment-type"
              value={v.employmentType}
              onChange={(e) => change("employmentType", e.target.value)}
              className={`mt-1 ${input}`}
            >
              <option value="">None</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-4 text-caption text-muted-foreground">
          03 Deployment, 04 Address, 05 Family and nominees, 06 Statutory and bank, 07 Previous
          organisations and 08 Restricted are on their card, which opens when you save.
        </p>

        {error && (
          <p role="alert" data-testid="add-error" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy !== null || !v.fullName.trim()}
            data-testid="add-save-draft"
            className="h-11 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-45"
          >
            {busy === "draft" ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={busy !== null || !v.fullName.trim() || !v.email.trim()}
            data-testid="add-send-invite"
            className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
          >
            {busy === "invite" ? "Sending…" : "Save and send invite"}
          </button>
        </div>
      </form>

      <section className="min-w-0 rounded-xl border border-border bg-card shadow-card">
        <h2 className="border-b border-border px-4 py-3 text-card-title font-semibold tracking-card-title">
          People you have added
        </h2>
        {overview === null ? (
          <div className="m-4 h-24 animate-pulse rounded bg-muted" />
        ) : overview.recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="added-list">
            {overview.recent.map((r) => (
              <li
                key={r.id}
                data-testid="added-row"
                className="flex flex-wrap items-center gap-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PersonLink employeeId={r.id} className="font-medium">
                      {r.fullName ?? r.email ?? "Unnamed"}
                    </PersonLink>
                    <StatusBadge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</StatusBadge>
                  </div>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {r.gaps.length === 0 ? "Complete" : `Missing: ${r.gaps.join(", ")}`} · added{" "}
                    {formatDate(r.createdAt)}
                  </p>
                  {rowError?.id === r.id && (
                    <p role="alert" className="mt-1 text-sm text-destructive">
                      {rowError.message}
                    </p>
                  )}
                </div>
                {r.stage === "draft" && (
                  <button
                    type="button"
                    onClick={() => void invite(r.id)}
                    disabled={inviting === r.id || !r.email}
                    title={r.email ? undefined : "Add their email on the card first"}
                    data-testid="added-invite"
                    className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-45"
                  >
                    {inviting === r.id ? "Sending…" : "Send invite"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ on the card

/** Who they are, while the record is still a draft (afterwards, People owns it). */
export function DraftEditor({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  useEffect(() => {
    getAdminOverview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);
  return (
    <FieldEditor
      id="draft"
      title="Who they are"
      label="Edit name and email"
      onSaved={onChanged}
      save={(vals) => updateDraft(card.id, vals as Record<string, string | null>)}
      fields={[
        {
          key: "fullName",
          label: "Full name",
          current: card.fullName,
          required: true,
          rule: "name",
          maxLength: 100,
        },
        {
          key: "email",
          label: "Work email",
          current: card.workEmail,
          clearable: true,
          inputMode: "email",
          rule: "email",
          maxLength: 200,
        },
        {
          key: "phone",
          label: "Mobile",
          current: card.mobile,
          clearable: true,
          inputMode: "tel",
          rule: "phone",
          maxLength: 20,
        },
        {
          key: "joinedDate",
          label: "Date of joining",
          kind: "date",
          current: card.dateOfJoining,
          clearable: true,
        },
        {
          key: "departmentId",
          label: "Department",
          kind: "select",
          clearable: true,
          current: card.department?.id,
          labelled: (overview?.departments ?? []).map((d) => [d.id, d.name] as const),
          emptyLabel: "None",
          add: addDepartmentChoice,
        },
      ]}
    />
  );
}

export function SendInviteButton({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid="card-send-invite"
        disabled={busy || !card.workEmail}
        title={card.workEmail ? undefined : "Add their email first"}
        onClick={async () => {
          setError("");
          setBusy(true);
          try {
            await sendInvite(card.id);
            await onChanged();
          } catch (err) {
            setError(errorText(err, "The invitation couldn't be sent."));
          } finally {
            setBusy(false);
          }
        }}
        className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
      >
        {busy ? "Sending…" : "Send invite"}
      </button>
      {error && (
        <p
          role="alert"
          data-testid="card-send-invite-error"
          className="text-caption text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Deactivate (bundle §7.7): says exactly what will happen before anything is
 * pressed, needs who takes over, the last working day and a reason, and then
 * says what it did.
 */
export function DeactivateDialog({
  card,
  onChanged,
}: {
  card: EmployeeCard;
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DeactivationPreview | null>(null);
  const [successor, setSuccessor] = useState("");
  const [lastDay, setLastDay] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<DeactivationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    getDeactivationPreview(card.id)
      .then(setPreview)
      .catch((e: unknown) => setError(errorText(e, "What this would do couldn't be worked out.")));
  }, [open, card.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setDone(await deactivateEmployee(card.id, successor, lastDay, reason));
    } catch (err) {
      setError(errorText(err, "They couldn't be deactivated."));
    } finally {
      setBusy(false);
    }
  }

  const successorName = preview?.successors.find((s) => s.profileId === successor)?.fullName;

  return (
    <>
      <button
        type="button"
        data-testid="deactivate"
        onClick={() => {
          setSuccessor("");
          setLastDay(todayIso());
          setReason("");
          setError("");
          setDone(null);
          setOpen(true);
        }}
        className="h-11 rounded-md border border-destructive-line px-4 text-sm font-medium text-destructive"
      >
        Deactivate
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && done) void onChanged();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deactivate {card.fullName}</DialogTitle>
            <DialogDescription>
              Their record is kept and marked Left. Nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <div data-testid="deactivate-done" className="grid gap-2 text-sm">
              <p className="font-medium">Done. This is what happened:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>They can no longer sign in, on the web or a phone.</li>
                <li>
                  {done.reports_moved} direct {done.reports_moved === 1 ? "report" : "reports"} and{" "}
                  {done.approvals_moved} waiting{" "}
                  {done.approvals_moved === 1 ? "approval" : "approvals"} moved to{" "}
                  {successorName ?? "their successor"}.
                </li>
                <li>
                  {done.postingClosed
                    ? `Their posting at ${done.postingClosed.unitName} closed on ${formatDate(done.postingClosed.lastDay)}.`
                    : "They had no open posting to close."}
                </li>
                <li>
                  Marked Left, with {formatDate(done.lastWorkingDay)} as their last working day.
                </li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void onChanged();
                }}
                className="mt-2 h-11 rounded-md border border-border px-4 text-sm"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-3">
              <div
                data-testid="deactivate-what-happens"
                className="rounded-lg border border-warning-line bg-warning-muted px-3.5 py-2.5 text-sm"
              >
                {preview === null ? (
                  "Working out what this will do…"
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Sign-in is blocked on the web and on phones.</li>
                    <li>
                      {preview.directReports} direct{" "}
                      {preview.directReports === 1 ? "report" : "reports"} and{" "}
                      {preview.pendingApprovals} waiting{" "}
                      {preview.pendingApprovals === 1 ? "approval" : "approvals"} move to the person
                      you choose.
                    </li>
                    <li>
                      {preview.openPosting
                        ? `Their posting at ${preview.openPosting.unitName} closes on their last working day.`
                        : "They have no open posting."}
                    </li>
                    <li>The record is kept and marked Left.</li>
                  </ul>
                )}
              </div>
              <label className="text-sm">
                <span className={eyebrow}>Who takes over</span>
                <select
                  required
                  data-testid="deactivate-successor"
                  value={successor}
                  onChange={(e) => setSuccessor(e.target.value)}
                  className={`mt-1 ${input}`}
                >
                  <option value="">Choose a manager or admin</option>
                  {(preview?.successors ?? []).map((s) => (
                    <option key={s.profileId} value={s.profileId}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className={eyebrow}>Last working day</span>
                <input
                  type="date"
                  required
                  data-testid="deactivate-last-day"
                  value={lastDay}
                  onChange={(e) => setLastDay(e.target.value)}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="text-sm">
                <span className={eyebrow}>Reason</span>
                <input
                  required
                  data-testid="deactivate-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Resigned"
                  className={`mt-1 ${input}`}
                />
              </label>
              {error && (
                <p role="alert" data-testid="deactivate-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !successor || !lastDay || reason.trim().length < 3}
                data-testid="deactivate-confirm"
                className="h-11 rounded-md bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-45"
              >
                {busy ? "Deactivating…" : "Deactivate"}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

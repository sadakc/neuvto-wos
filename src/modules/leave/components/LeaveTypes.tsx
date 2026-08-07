/**
 * Leave types — what an administrator configures for the whole company.
 *
 * The first thing Sada went looking for and did not find. The database has
 * allowed this write since step 6; nothing was ever built to make it, so a
 * workspace could be signed into and not used.
 *
 * Contributed to Settings through `adminSections`, so the platform's settings
 * page renders it without importing this module or knowing Leave exists.
 *
 * Entitlement is not set per person here, and that is the design: days per year
 * on the type, pro-rated by joined date (D3). One number configures the company.
 * Per-person opening balances are step 10, for customers arriving mid-year.
 */

import { useEffect, useState } from "react";
import { getCurrentUser, type CurrentUser } from "@/platform/auth";
import { getOrgSettings } from "@/platform/calendar";
import { isAppError } from "@/platform/errors";
import { listLeaveTypes, saveLeaveType, setLeaveTypeStatus } from "../handlers";
import { LeaveTypeInput, type LeaveType } from "../contracts";

/** The form's own shape: numbers are strings until they parse. */
type Draft = {
  id?: string;
  name: string;
  description: string;
  maxDaysPerYear: string;
  minNoticeDays: string;
  maxPerRequest: string;
  approvalRequired: boolean;
};

/**
 * `minNoticeDays` starts BLANK, not "0" — and that one character was the whole
 * reason the workspace-level notice setting appeared to do nothing.
 *
 * The database resolves
 *
 *     coalesce(v_type.min_notice_days, v_settings.default_min_notice_days, 0)
 *
 * so a leave type leaving notice blank inherits the organisation's default.
 * Pre-filling the field with "0" meant every type ever created through this form
 * carried an explicit zero, which OVERRODE the default. The helper text said
 * "Blank uses the workspace default" while the form guaranteed it was never
 * blank.
 *
 * Sada asked whether the two settings were duplicates. They are not — one is the
 * fallback for the other — but they behaved like it, because in practice the
 * fallback could never be reached.
 */
const EMPTY: Draft = {
  name: "",
  description: "",
  maxDaysPerYear: "12",
  minNoticeDays: "",
  approvalRequired: true,
  maxPerRequest: "",
};

const toDraft = (t: LeaveType): Draft => ({
  id: t.id,
  name: t.name,
  description: t.description ?? "",
  maxDaysPerYear: String(t.maxDaysPerYear),
  minNoticeDays: t.minNoticeDays === null ? "" : String(t.minNoticeDays),
  maxPerRequest: t.maxPerRequest === null ? "" : String(t.maxPerRequest),
  approvalRequired: t.approvalRequired,
});

/** Blank means "no limit", which is not the same as zero — hence null, not 0. */
const optionalNumber = (v: string) => (v.trim() === "" ? null : Number(v));

export default function LeaveTypes() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /**
   * The workspace's fallback notice, so a type that inherits it can say the
   * number rather than saying nothing. Null while unknown, and the row then
   * says "the workspace default" without inventing a figure.
   */
  const [defaultNotice, setDefaultNotice] = useState<number | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setTypes(await listLeaveTypes());
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCurrentUser(), listLeaveTypes()])
      .then(([u, t]) => {
        if (cancelled) return;
        setUser(u);
        setTypes(t);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));

    // Separate, and deliberately not in the Promise.all above: the settings read
    // is decoration. Failing it must not blank a screen whose actual job —
    // configuring leave types — works perfectly without it.
    getOrgSettings()
      .then((s) => !cancelled && setDefaultNotice(s?.defaultMinNoticeDays ?? null))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !user) return;
    setError("");
    setSaving(true);
    try {
      const parsed = LeaveTypeInput.parse({
        id: draft.id,
        name: draft.name,
        description: draft.description || undefined,
        maxDaysPerYear: Number(draft.maxDaysPerYear),
        minNoticeDays: optionalNumber(draft.minNoticeDays),
        maxPerRequest: optionalNumber(draft.maxPerRequest),
        approvalRequired: draft.approvalRequired,
      });
      await saveLeaveType(parsed, user.organizationId);
      await load();
      setDraft(null);
    } catch (err) {
      // A Zod message is written for the person reading it; anything else comes
      // from the database and has already been translated.
      setError(
        isAppError(err)
          ? err.message
          : err instanceof Error && "issues" in err
            ? (err as { issues: { message: string }[] }).issues[0].message
            : "That didn't save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus(t: LeaveType) {
    setError("");
    try {
      await setLeaveTypeStatus(t.id, t.status === "active" ? "archived" : "active");
      await load();
    } catch (err) {
      setError(isAppError(err) ? err.message : "That didn't work. Please try again.");
    }
  }

  if (state === "loading") {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  }

  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your leave types just now. Try refreshing.
      </p>
    );
  }

  const active = types.filter((t) => t.status === "active");
  const archived = types.filter((t) => t.status === "archived");

  return (
    <div>
      {types.length === 0 && !draft && (
        <p className="mb-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No leave types yet. Until you add one, nobody in this workspace can apply for leave.
        </p>
      )}

      {types.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {[...active, ...archived].map((t) => (
            <li
              key={t.id}
              data-testid="leave-type-row"
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t.name}
                  {t.status === "archived" && (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                      Archived
                    </span>
                  )}
                </p>
                {/* Notice was `t.minNoticeDays ? … : ""`, which is silent for
                    BOTH null and 0 — so a type inheriting the workspace default
                    and a type overriding it with zero read identically, and
                    neither said which. That is the display half of the same
                    confusion the blank default fixes. */}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.maxDaysPerYear} {t.maxDaysPerYear === 1 ? "day" : "days"} a year
                  {t.minNoticeDays === null
                    ? defaultNotice === null
                      ? " · notice: the workspace default"
                      : defaultNotice > 0
                        ? ` · ${defaultNotice} ${defaultNotice === 1 ? "day" : "days"}' notice (workspace default)`
                        : " · no notice needed (workspace default)"
                    : t.minNoticeDays > 0
                      ? ` · ${t.minNoticeDays} ${t.minNoticeDays === 1 ? "day" : "days"}' notice`
                      : " · no notice needed"}
                  {t.maxPerRequest ? ` · up to ${t.maxPerRequest} at a time` : ""}
                  {!t.approvalRequired && " · no approval needed"}
                </p>
                {t.description && (
                  <p className="mt-1 max-w-prose text-xs text-muted-foreground">{t.description}</p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => {
                    setError("");
                    setDraft(toDraft(t));
                  }}
                  className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => onToggleStatus(t)}
                  data-testid="archive-leave-type"
                  className="inline-flex h-12 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
                >
                  {t.status === "active" ? "Archive" : "Restore"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!draft && (
        <button
          onClick={() => {
            setError("");
            setDraft({ ...EMPTY });
          }}
          data-testid="add-leave-type"
          className="mt-4 inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Add a leave type
        </button>
      )}

      {draft && (
        <form
          onSubmit={onSave}
          data-testid="leave-type-form"
          className="mt-4 space-y-4 rounded-lg border border-border p-4"
        >
          <div>
            <label htmlFor="lt-name" className="block text-sm font-medium">
              Name
            </label>
            <input
              id="lt-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Casual leave"
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          <div>
            <label htmlFor="lt-desc" className="block text-sm font-medium">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="lt-desc"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={300}
              className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="lt-days" className="block text-sm font-medium">
                Days a year
              </label>
              <input
                id="lt-days"
                type="number"
                inputMode="decimal"
                min={0}
                max={365}
                // Whole days or halves. Entitlement is pro-rated onto the same
                // grid, so a type set to 12.4 could never be honoured exactly.
                step={0.5}
                value={draft.maxDaysPerYear}
                onChange={(e) => setDraft({ ...draft, maxDaysPerYear: e.target.value })}
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Whole days or halves. Pro-rated for anyone who joins part-way through the year
              </p>
            </div>

            <div>
              <label htmlFor="lt-notice" className="block text-sm font-medium">
                Notice needed
              </label>
              <input
                id="lt-notice"
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={draft.minNoticeDays}
                onChange={(e) => setDraft({ ...draft, minNoticeDays: e.target.value })}
                placeholder={defaultNotice === null ? "" : String(defaultNotice)}
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              {/* The placeholder shows the inherited number, so leaving this
                  blank is visibly a choice rather than an omission. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {defaultNotice === null
                  ? "Days. Blank uses the workspace default"
                  : defaultNotice > 0
                    ? `Days. Blank uses the workspace default of ${defaultNotice}`
                    : "Days. Blank uses the workspace default, which is none"}
              </p>
            </div>

            <div>
              <label htmlFor="lt-max" className="block text-sm font-medium">
                Most at a time
              </label>
              <input
                id="lt-max"
                type="number"
                inputMode="decimal"
                min={0.5}
                max={365}
                step={0.5}
                value={draft.maxPerRequest}
                onChange={(e) => setDraft({ ...draft, maxPerRequest: e.target.value })}
                className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">Blank means no limit</p>
            </div>
          </div>

          {/* D38. The reason this switch exists, spelled out — it is the only
              way a one-person workspace can book anything, and an admin has no
              way to guess that from the label alone. */}
          <div className="rounded-md border border-border p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={draft.approvalRequired}
                onChange={(e) => setDraft({ ...draft, approvalRequired: e.target.checked })}
                data-testid="approval-required"
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium">Needs approval</span>
                <span className="block text-xs text-muted-foreground">
                  Off means it is approved the moment somebody applies. Useful for compensatory time
                  off — and it is the only way to book leave in a workspace where nobody has a
                  manager yet, since people cannot approve their own requests.
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p role="alert" data-testid="leave-type-error" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={saving}
              data-testid="save-leave-type"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : draft.id ? "Save changes" : "Add leave type"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError("");
              }}
              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

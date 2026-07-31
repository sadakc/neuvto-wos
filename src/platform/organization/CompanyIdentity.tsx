/**
 * The company's own details — the first thing their administrator configures.
 *
 * Used twice, deliberately: as a step in the setup wizard and as a section in
 * Settings. Somebody who skipped it on day one must be able to finish it on day
 * ten, and two copies of a form is two places for the validation to drift.
 */

import { useEffect, useRef, useState } from "react";
import { isAppError } from "@/platform/errors";
import {
  companyName,
  getLogoUrl,
  getOrganization,
  identityChanged,
  removeLogo,
  updateOrganization,
  uploadLogo,
  type Organization,
} from ".";

/** Broad on purpose — this is a label, not a taxonomy anybody reports on. */
const INDUSTRIES = [
  "Security services",
  "Facilities management",
  "Manufacturing",
  "Retail",
  "Healthcare",
  "Technology",
  "Construction",
  "Logistics",
  "Hospitality",
  "Other",
];

export function CompanyIdentity({ onSaved }: { onSaved?: (org: Organization) => void }) {
  const [org, setOrg] = useState<Organization | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [industry, setIndustry] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Re-reads the organisation.
   *
   * `resetFields` is false for the logo, and that is the whole point: uploading
   * one used to re-read everything and overwrite the text inputs from the
   * server, silently discarding whatever had been typed but not yet saved.
   * Found by typing a display name, uploading a logo, and watching both the
   * name and the industry go back to blank.
   */
  async function load(resetFields = true) {
    const o = await getOrganization();
    if (!o) throw new Error("no organisation");
    setOrg(o);
    if (resetFields) {
      setName(o.name);
      setDisplayName(o.displayName ?? "");
      setIndustry(o.industryType ?? "");
    }
    setLogoUrl(await getLogoUrl(o.logoPath, o.logoUpdatedAt));
    return o;
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then(() => !cancelled && setState("ready"))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    if (!org) return;
    setError("");
    setSaving(true);
    try {
      await updateOrganization(org.id, { name, displayName, industryType: industry });
      const fresh = await load();
      setSaved(true);
      identityChanged();
      onSaved?.(fresh);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so choosing the same file twice still fires a change.
    e.target.value = "";
    if (!file || !org) return;

    setError("");
    setSaving(true);
    try {
      await uploadLogo(org.id, file);
      const fresh = await load(false);
      identityChanged();
      onSaved?.(fresh);
    } catch (err) {
      setError(isAppError(err) ? err.message : "That image couldn't be uploaded.");
    } finally {
      setSaving(false);
    }
  }

  async function onRemoveLogo() {
    if (!org?.logoPath) return;
    setError("");
    try {
      await removeLogo(org.id, org.logoPath);
      const fresh = await load(false);
      identityChanged();
      onSaved?.(fresh);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That logo couldn't be removed.");
    }
  }

  if (state === "loading") return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your company details just now. Try refreshing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─────────────────────────────────────────────── the mark */}
      <div>
        <span className="block text-sm font-medium">Logo</span>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary/40">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${companyName(org)} logo`}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="font-display text-2xl font-semibold text-muted-foreground">
                {companyName(org).slice(0, 1).toUpperCase() || "?"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={saving}
              data-testid="pick-logo"
              className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
            >
              {org?.logoPath ? "Replace" : "Upload a logo"}
            </button>
            {org?.logoPath && (
              <button
                onClick={onRemoveLogo}
                className="inline-flex h-12 items-center rounded-md border border-border px-4 text-sm text-muted-foreground"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onPickLogo}
            className="hidden"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          PNG, JPEG or WebP, up to 2 MB. It&apos;s resized and re-saved on upload, so nothing hidden
          in the original travels with it.
        </p>
      </div>

      {/* ─────────────────────────────────────────────── the names */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="org-legal-name" className="block text-sm font-medium">
            Registered company name
          </label>
          <input
            id="org-legal-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            maxLength={200}
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">As it appears on a contract</p>
        </div>

        <div>
          <label htmlFor="org-display-name" className="block text-sm font-medium">
            Display name
          </label>
          <input
            id="org-display-name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            maxLength={60}
            placeholder={name}
            data-testid="display-name"
            className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            What your people see. Blank uses the registered name
          </p>
        </div>
      </div>

      <div className="sm:max-w-xs">
        <label htmlFor="org-industry" className="block text-sm font-medium">
          Industry
        </label>
        <select
          id="org-industry"
          value={industry}
          onChange={(e) => {
            setIndustry(e.target.value);
            setSaved(false);
          }}
          className="mt-2 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">Choose…</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" data-testid="identity-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onSave}
          disabled={saving || !name.trim()}
          data-testid="save-identity"
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>

      {/* The workspace address is deliberately absent. Changing it breaks every
          link anyone holds and can collide with another customer, so the column
          grant does not include it — a support action, not a self-serve one. */}
      <p className="text-xs text-muted-foreground">
        Workspace address: <span className="text-foreground">{org?.slug}</span> · get in touch if
        this needs to change
      </p>
    </div>
  );
}

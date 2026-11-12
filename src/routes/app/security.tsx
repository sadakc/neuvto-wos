import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint, MailCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSessionEmail } from "@/platform/auth";
import {
  deviceSupportsPasskeys,
  listPasskeys,
  registerThisDevice,
  removePasskey,
  type Passkey,
} from "@/platform/auth/passkeys";
import { isAppError } from "@/platform/errors";

export const Route = createFileRoute("/app/security")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign-in and security — Neuvto WOS" }] }),
  component: SecurityPage,
});

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "Not yet";

/**
 * D79. How this person gets in: the email code always, and face or
 * fingerprint on whichever devices they have set up.
 *
 * Everybody's, not an administrator's: a passkey is enrolled by its owner on
 * their own device, because the private key is created inside that device and
 * never leaves it. Nobody can set one up for somebody else, which is the point.
 */
function SecurityPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Passkey[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await listPasskeys());
      setLoadError("");
    } catch (e) {
      setDevices([]);
      setLoadError(isAppError(e) ? e.message : "Your devices couldn't be loaded.");
    }
  }, []);

  useEffect(() => {
    void getSessionEmail().then(setEmail);
    void deviceSupportsPasskeys().then(setSupported);
    void load();
  }, [load]);

  async function onAdd() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (await registerThisDevice()) {
        setNotice("Done. Next time, choose “Sign in with face or fingerprint”.");
        await load();
      }
    } catch (e) {
      setError(isAppError(e) ? e.message : "This device couldn't be set up.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(d: Passkey) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await removePasskey(d.id);
      setNotice(`${d.name} removed. It can no longer sign you in.`);
      await load();
    } catch (e) {
      setError(isAppError(e) ? e.message : "That device couldn't be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4.5">
      <div>
        <h1 className="text-page-title font-semibold tracking-page-title">Sign-in and security</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-secondary">
          How you get into Neuvto. An email code always works. Face or fingerprint is faster, and
          works only on a device you have set it up on.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-success-line bg-success-muted px-3.5 py-2.5 text-sm text-success"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid="security-error"
          className="rounded-lg border border-destructive-line bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <section className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <MailCheck className="size-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-card-title font-semibold tracking-card-title">Email code</h2>
            <p className="text-caption text-muted-foreground">Always on. Cannot be switched off.</p>
          </div>
        </div>
        <p className="px-4 py-3.5 text-sm text-foreground-secondary">
          We send a six-digit code to{" "}
          <span className="font-mono">{email ?? "your work email"}</span>. If you lose a phone or
          change laptops, this is how you get back in.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5">
          <Fingerprint className="size-5 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-card-title font-semibold tracking-card-title">
              Face or fingerprint
            </h2>
            <p className="text-caption text-muted-foreground">
              Face ID, Touch ID, Windows Hello or your phone&apos;s fingerprint sensor.
            </p>
          </div>
          {supported && (
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={busy}
              data-testid="add-passkey"
              className="ml-auto inline-flex h-12 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
            >
              {busy ? "Waiting for your device…" : "Set up on this device"}
            </button>
          )}
        </div>

        {supported === false && (
          <p
            data-testid="passkey-unsupported"
            className="px-4 py-3.5 text-sm text-foreground-secondary"
          >
            This browser or device can&apos;t do face or fingerprint sign-in. Try it from your
            phone, or from a laptop with a fingerprint reader or camera sign-in. Your email code
            still works here.
          </p>
        )}

        {loadError ? (
          <p role="alert" className="px-4 py-3.5 text-sm text-destructive">
            {loadError}
          </p>
        ) : devices === null ? (
          <div className="m-4 h-12 animate-pulse rounded-md bg-muted" />
        ) : devices.length === 0 ? (
          <p data-testid="no-passkeys" className="px-4 py-3.5 text-sm text-muted-foreground">
            No devices set up yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li
                key={d.id}
                data-testid="passkey-row"
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{d.name}</p>
                  <p className="font-mono text-code text-muted-foreground">
                    Added {when(d.createdAt)} · Last used {when(d.lastUsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onRemove(d)}
                  disabled={busy}
                  aria-label={`Remove ${d.name}`}
                  className="inline-flex h-12 items-center gap-1.5 rounded-md border border-destructive-line bg-destructive-muted px-3 text-sm font-medium text-destructive disabled:opacity-45"
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-border bg-muted px-4 py-2.5 text-caption text-foreground-secondary">
          Your face or fingerprint never leaves your device. Neuvto stores only a public key that
          proves the device is yours. Removing a device here stops it signing you in, everywhere.
        </p>
      </section>
    </div>
  );
}

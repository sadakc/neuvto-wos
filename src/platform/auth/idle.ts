import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hardNavigate } from "@/platform/navigate";
import { signOut } from "./otp";
import { getSessionStartedAt } from "./session";
import { getSessionPolicy } from "./session-policy";
import { decide } from "./idle-policy";
import { sanitizeRoute } from "@/platform/observability/scrub";

/**
 * Signs somebody out after a period of inactivity.
 *
 * The rule is in `idle-policy.ts`; this is the plumbing that feeds it. Installed
 * once at the root, next to `installGlobalErrorHandlers` — not per route,
 * because route guards in this app are already duplicated in a dozen places and
 * a thirteenth copy of session logic is how the twelfth goes stale.
 *
 * ── what this is, and what it is not
 *
 * It ends the session IN THIS BROWSER. That is a real control for the threat
 * this product actually has: a shared shop-floor terminal, a supervisor's tablet
 * on a desk, a laptop left open in a canteen.
 *
 * It does not shorten any token's life. The refresh token sits in localStorage
 * with `autoRefreshToken: true`, and anybody who exfiltrates it mints access
 * tokens for as long as it lasts, timer or no timer. It is defeated by closing
 * the tab, disabling JavaScript, or replaying the stored token with curl. See
 * the "Where this stands" block in NEUVTO_SECURITY_POLICY.md before describing
 * this as enforcement to anybody.
 *
 * ── why a poll and not a timeout
 *
 * `setTimeout(30 minutes)` is wrong in the two cases that matter most. A
 * background tab is throttled, so it fires late; a laptop that slept does not
 * fire at all until wake, and then fires once with no idea how long it was gone.
 * A short interval comparing wall clocks handles both: the first tick after wake
 * sees the real gap and expires immediately.
 */

const TICK_MS = 15_000;
const WARN_SECONDS = 60;

/** Written at most this often, so a keystroke does not wake every other tab. */
const WRITE_THROTTLE_MS = 30_000;

/**
 * Shared across tabs. Naming follows THEME_STORAGE_KEY in design/theme.ts.
 *
 * The activity key is the reason a second tab does not sign you out while you
 * work in the first: every tab READS it on every tick rather than trusting its
 * own memory of when it last saw a keystroke.
 */
const ACTIVITY_KEY = "neuvto.session.lastActivityAt";
const ENDED_KEY = "neuvto.session.endedReason";

/** Where the timer must never run: expiring somebody mid-sign-in is a loop. */
function onAuthPage(): boolean {
  return window.location.pathname === "/auth";
}

function readActivity(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    // Private mode, or storage disabled. Null means "not seen yet", which
    // `decide` treats as active — the session simply does not idle out.
    return null;
  }
}

function writeActivity(at: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    /* nothing to do, and nowhere to say it */
  }
}

function clearKeys(): void {
  try {
    localStorage.removeItem(ACTIVITY_KEY);
    localStorage.removeItem(ENDED_KEY);
  } catch {
    /* ignore */
  }
}

export function installIdleWatcher(): () => void {
  if (typeof window === "undefined") return () => {};

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastWrite = 0;
  let warned = false;
  /** One sign-out, however many ticks or tabs decide it at once. */
  let ending = false;
  let armed = false;

  const touch = () => {
    const now = Date.now();
    warned = false;
    if (now - lastWrite < WRITE_THROTTLE_MS) return;
    lastWrite = now;
    writeActivity(now);
  };

  const end = async (reason: "idle" | "absolute") => {
    if (ending) return;
    // The in-closure flag stops one watcher signing out twice. It does NOT stop
    // TWO watchers doing it once each — each closure has its own — and two is
    // not hypothetical: React StrictMode mounts, unmounts and remounts every
    // effect in development. Caught by a test that installed a second watcher
    // and watched `signOut` fire twice.
    //
    // The shared guard is the key that already exists for the cross-tab case.
    // Whoever writes it first owns the sign-out; everybody else, in this tab or
    // any other, follows rather than races.
    try {
      if (localStorage.getItem(ENDED_KEY)) {
        ending = true;
        return;
      }
    } catch {
      /* storage unavailable — fall through to the per-closure guard alone */
    }
    ending = true;
    try {
      localStorage.setItem(ENDED_KEY, reason);
    } catch {
      /* ignore */
    }
    try {
      await signOut();
    } catch {
      // Already gone, or the network is down. Either way the browser must not
      // stay on a signed-in screen.
    }
    // The path, not the URL: `sanitizeRoute` drops the query string, which is
    // where an invitation token would be. Returning somebody to where they were
    // is good manners; carrying a credential through a security event is not.
    const back = sanitizeRoute(window.location.pathname);
    const next = back && back !== "/" ? `&next=${encodeURIComponent(back)}` : "";
    hardNavigate(`/auth?reason=${reason}${next}`);
  };

  const tick = async () => {
    if (!armed || ending || onAuthPage()) return;

    const [policy, startedAt] = await Promise.all([
      getSessionPolicy(),
      getSessionStartedAt().catch(() => null),
    ]);

    const verdict = decide({
      now: Date.now(),
      lastActivityAt: readActivity(),
      sessionStartedAt: startedAt,
      idleMinutes: policy.idleMinutes,
      absoluteHours: policy.absoluteHours,
      warnSeconds: WARN_SECONDS,
    });

    if (verdict === "expired-idle") return void end("idle");
    if (verdict === "expired-absolute") return void end("absolute");

    if (verdict === "warn" && !warned) {
      warned = true;
      // Only where somebody can see it. Three background tabs stacking three
      // toasts is how a considerate warning becomes an annoyance.
      if (document.visibilityState !== "visible") return;
      toast.warning("You'll be signed out shortly", {
        description: "You've been inactive for a while.",
        duration: WARN_SECONDS * 1000,
        action: {
          label: "Stay signed in",
          onClick: () => {
            lastWrite = 0;
            touch();
          },
        },
      });
    }
  };

  const onVisibility = () => {
    // Deliberately EVALUATES rather than resets. Coming back to a tab is not
    // activity that happened while you were away — treating it as such would
    // make the timeout unreachable for anybody who switches apps.
    if (document.visibilityState === "visible") void tick();
  };

  const arm = () => {
    if (armed) return;
    armed = true;
    // A live session makes any previous "ended" record stale by definition, and
    // leaving one behind would make `end` refuse to sign this person out ever
    // again — a timeout that works exactly once per browser.
    try {
      localStorage.removeItem(ENDED_KEY);
    } catch {
      /* ignore */
    }
    ending = false;
    // Seed, so the first tick does not read a null it inherited from a previous
    // session and the watcher has a baseline from the moment it starts.
    lastWrite = 0;
    touch();
    for (const ev of ["pointerdown", "keydown", "scroll", "focus"] as const) {
      window.addEventListener(ev, touch, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    timer = setInterval(() => void tick(), TICK_MS);
  };

  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const ev of ["pointerdown", "keydown", "scroll", "focus"] as const) {
      window.removeEventListener(ev, touch);
    }
    document.removeEventListener("visibilitychange", onVisibility);
    if (timer) clearInterval(timer);
    timer = null;
  };

  // Another tab signed out, or expired. Follow it rather than racing it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === ENDED_KEY && e.newValue && !ending) {
      ending = true;
      hardNavigate(`/auth?reason=${e.newValue === "absolute" ? "absolute" : "idle"}`);
    }
  };
  window.addEventListener("storage", onStorage);

  // The repo's only onAuthStateChange. Nothing is awaited inside it: GoTrue
  // invokes the callback while holding its own lock, and awaiting a supabase
  // call there deadlocks.
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      disarm();
      clearKeys();
      return;
    }
    if (event === "SIGNED_IN") {
      // SEED a fresh timestamp; do NOT clear the key and hope arm() rewrites it.
      //
      // This line used to be `clearKeys()`, and it silently disabled the entire
      // timeout. On any page load with an existing session the order is:
      //
      //   1. getSession() resolves  → arm() → armed = true, key written
      //   2. supabase fires SIGNED_IN → clearKeys() removes the key
      //   3. arm() is called again  → `if (armed) return` → never re-seeds
      //
      // leaving a watcher that ticks forever against a null baseline, which
      // decide() correctly reads as "not idle yet". The timer ran; nobody was
      // ever signed out. Found on 5 Aug 2026 by signing in and looking at
      // localStorage, not by a test — idle.test.ts drove this event by hand in
      // an order that could not reproduce it, and asserted "not signed out",
      // which is true both when it works and when it is broken.
      try {
        localStorage.removeItem(ENDED_KEY);
      } catch {
        /* ignore */
      }
      ending = false;
      lastWrite = 0;
      touch();
    }
    if (session && !onAuthPage()) arm();
    else if (!session) disarm();
  });

  // A page that loads already signed in never fires SIGNED_IN.
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session && !onAuthPage()) arm();
  });

  return () => {
    disarm();
    window.removeEventListener("storage", onStorage);
    sub?.subscription?.unsubscribe();
  };
}

// ============================================================================
// NEUVTO WOS — the error channel for callers who have no session
//
// WHY THIS IS PUBLIC, WHICH IS THE ONLY INTERESTING THING ABOUT IT
//
// `record_client_error` is granted to `authenticated` only, deliberately, and
// that stays true. The gap it leaves was named when it was written: a crash on
// `/`, on `/auth`, or during invitation acceptance is reported by nobody,
// because nobody in that state has a session.
//
// On 6 Aug 2026 Resend began rejecting Supabase's SMTP login. Sign-in was dead
// for every address for thirteen hours and `client_errors` stayed empty the
// whole time — everybody hitting it was anonymous, which is precisely what
// "cannot sign in" means. A human found it. Nothing built to notice did.
//
// So this endpoint accepts unauthenticated POSTs. That is the requirement, not
// an oversight, and `verify_jwt = false` in config.toml is what makes it work.
//
// WHAT KEEPS IT FROM BEING THE 2 AUG MISTAKE AGAIN
//
// On 2 Aug 2026 an anonymous caller could reach `notify_address` and queue mail
// to any address from a verified sending domain. An open relay. The lesson
// drawn was a posture — `anon` executes nothing — and this function does not
// weaken it by one grant. `anon` still cannot execute a single database
// function. This process holds the service key; the only caller that reaches
// Postgres is one we deploy.
//
// The distinction matters and is worth being precise about, because "it is
// bounded, it only writes one table" is the exact argument that made
// `notify_address` look fine:
//
//   · `notify_address` SENT SOMETHING, to an attacker-chosen address, from our
//     domain. The output was the prize.
//   · This writes one bounded, scrubbed, deduplicated row to a table only a
//     platform admin can read. There is no output to steal and nowhere for it
//     to go.
//
// LAYERS, WEAKEST FIRST, LABELLED HONESTLY
//
//   1. Origin allowlist — a speed bump, NOT a security control. Any curl can
//      set an Origin header. It stops other people's web pages from posting
//      here and stops casual scanners; it stops a determined attacker for
//      exactly zero seconds. It is here because it is free, not because it
//      protects anything.
//   2. Method, content-type and a hard body cap — cheap, checked before the
//      body is read into memory.
//   3. Per-IP token bucket, in memory. Real but partial: edge instances are
//      ephemeral and there may be several, so a distributed caller gets one
//      bucket per instance. It bounds a single noisy client, not a botnet.
//   4. THE ACTUAL BOUND — `record_public_client_error` stops after 100 distinct
//      fingerprints per UTC day, counted over `source = 'public'` only. Nothing
//      a caller does can grow the table past that, and critically, nothing a
//      caller does can spend the SIGNED-IN budget. Filling this one blinds this
//      channel and leaves customer error reporting untouched.
//
// Layer 4 is the one to trust. The rest reduce noise.
//
// The response is always 204, whatever happened — recorded, throttled,
// malformed, ceiling reached. The database ceiling is silent by design so a
// prober cannot learn its budget, and it would be pointless to make it silent
// in Postgres and then announce it in HTTP. It also means this endpoint tells
// an attacker nothing at all about its own state.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * Origins whose pages may post here.
 *
 * Overridable so a preview deployment does not need a code change, and so the
 * test can drive it. Anything not listed gets 204 and is dropped — never a 403,
 * which would merely tell a prober which origins are interesting.
 */
const ALLOWED_ORIGINS = (
  Deno.env.get("CLIENT_ERROR_ORIGINS") ??
  "https://neuvto.com,https://www.neuvto.com,https://neuvto.lovable.app,http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** Comfortably above a scrubbed 500-char message plus a 4000-char stack. */
const MAX_BODY_BYTES = 16_384;

/** Per-IP budget. Twenty reports a minute is far past a real browser's need. */
const RATE_LIMIT = Number(Deno.env.get("CLIENT_ERROR_RATE_LIMIT") ?? "20");
const RATE_WINDOW_MS = 60_000;

/**
 * Bounded so the map itself cannot become the memory leak. When it fills, the
 * oldest entries go — which at worst forgives some old offenders, and never
 * denies a new caller.
 */
const MAX_TRACKED_IPS = 5_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;

  if (hits.size > MAX_TRACKED_IPS) {
    for (const [k, times] of hits) {
      if (times.every((t) => t < cutoff)) hits.delete(k);
      if (hits.size <= MAX_TRACKED_IPS) break;
    }
  }

  const recent = (hits.get(ip) ?? []).filter((t) => t >= cutoff);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  // Echo only an allowed origin, never `*`. A wildcard here would let any page
  // on the internet read the response — which is empty, so it would leak
  // nothing, but a wildcard that is safe only because of what is behind it is
  // the kind of thing that stops being safe when somebody changes what is
  // behind it.
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "null",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** One shape, used for every outcome. See the header: 204 always. */
function done(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function clientIp(req: Request): string {
  // Supabase sits behind a proxy, so the socket address is the proxy's. The
  // left-most x-forwarded-for entry is the caller as the edge saw it. It is
  // spoofable, which is fine: this feeds a noise limiter, not a decision about
  // trust, and layer 4 does not care who anybody is.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return done(origin);

  // An Origin header is present on every cross-origin browser POST. Its absence
  // means this did not come from a page, which is not a crime — but it is also
  // not the case this endpoint exists to serve.
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return done(origin);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return done(origin);

  if (rateLimited(clientIp(req))) return done(origin);

  if (!SERVICE_KEY) {
    // Misconfiguration, not abuse. Logged so it is visible in the function log
    // rather than looking like a quiet, working endpoint that records nothing —
    // which is the exact failure this whole feature exists to stop.
    console.error("[client-error] SUPABASE_SERVICE_ROLE_KEY is not set; nothing can be recorded");
    return done(origin);
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    // Checked again after reading: content-length is a claim, and a chunked
    // request does not have to make it.
    if (text.length > MAX_BODY_BYTES) return done(origin);
    body = JSON.parse(text);
  } catch {
    return done(origin);
  }

  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };

  const fingerprint = str(body.fingerprint, 200);
  const message = str(body.message, 500);
  if (!fingerprint || !message) return done(origin);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Everything that actually protects the data lives on the other side of this
  // call: truncation, D42 scrubbing, per-day aggregation, and the ceiling. This
  // process deliberately holds none of those rules — a second copy of a
  // redaction rule is the copy that stops being maintained.
  const { error } = await supabase.rpc("record_public_client_error", {
    p_fingerprint: fingerprint,
    p_message: message,
    p_mechanism: str(body.mechanism, 50) ?? "unknown",
    p_stack: str(body.stack, 4000),
    p_route: str(body.route, 200),
    p_severity: str(body.severity, 20) ?? "error",
    p_release: str(body.release, 100),
    p_user_agent: str(body.user_agent, 300),
  });

  if (error) {
    // Never surfaced to the caller — but it must not vanish either. A grant
    // silently revoked by a later migration would otherwise look exactly like
    // an endpoint nobody is using.
    console.error("[client-error] record_public_client_error failed:", error.message);
  }

  return done(origin);
});

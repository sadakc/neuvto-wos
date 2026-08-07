// ============================================================================
// NEUVTO WOS — the public demo form
//
// The second and last public endpoint in the system. It exists for the same
// reason `client-error` does: the caller has no session and never will, and the
// alternative is granting `anon` something.
//
// It replaces `submitDemoRequest`, a TanStack server function that used
// `supabaseAdmin` — the only caller of the admin client anywhere in the
// codebase, and therefore the only reason a service role key had to exist
// outside Supabase at all. A key that bypasses RLS on every table, carried for
// a form that collects a name and an email from strangers.
//
// Read the header of `client-error/index.ts` for the full argument about why a
// public endpoint is acceptable here and was not on 2 Aug 2026. The short
// version: `anon` still executes nothing, this process holds the service key,
// and the only caller that reaches Postgres is one we deploy.
//
// WHAT IS DIFFERENT FROM client-error
//
// This one is not an error reporter, so it CAN answer honestly. A person is
// waiting at a form and deserves to know whether their request arrived, which
// means this returns 200 or 400 rather than 204-for-everything.
//
// It still says nothing about the CEILING. "We are full for today" tells a
// prober its budget; a lead that quietly lands in the gap is a worse outcome
// for us than for them, and the ceiling is set high enough that a real visitor
// will never see it.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Shared with notification-dispatch, and deliberately the same defaults: one
// sending identity, one place to change it. RESEND_API_KEY is already a secret
// on this project; DEMO_REQUEST_RECIPIENT is the only new one.
const RESEND_BASE = Deno.env.get("RESEND_API_BASE") ?? "https://api.resend.com";
const FROM = Deno.env.get("NOTIFICATION_FROM") ?? "Neuvto <notifications@neuvto.com>";

const ALLOWED_ORIGINS = (
  Deno.env.get("DEMO_REQUEST_ORIGINS") ??
  "https://neuvto.com,https://www.neuvto.com,https://neuvto-wos.netlify.app,http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** A 2000-character message plus four short fields, with room to spare. */
const MAX_BODY_BYTES = 8_192;

/** Per-IP. A person fills this in once; five a minute is already generous. */
const RATE_LIMIT = Number(Deno.env.get("DEMO_REQUEST_RATE_LIMIT") ?? "5");
const RATE_WINDOW_MS = 60_000;

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
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "null",
    // `content-type` alone was wrong on client-error and cost a deploy: a
    // caller using supabase-js's functions.invoke sends apikey, authorization
    // and x-client-info, and every one of them turns a simple POST into a
    // preflighted one. curl issues no preflight, so the endpoint answered a
    // hand-rolled probe perfectly and refused every real browser.
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(origin: string | null, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Deliberately the same shape the database enforces. Neither trusts the other. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json(origin, 405, { error: "Method not allowed" });
  }
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    // A speed bump, not a control — any curl sets an Origin header. It stops
    // other people's pages posting here and stops casual scanners, and that is
    // all it is claimed to do.
    return json(origin, 403, { error: "Not allowed" });
  }
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return json(origin, 413, { error: "That message is too long." });
  }
  if (rateLimited(clientIp(req))) {
    return json(origin, 429, { error: "Too many requests. Please wait a moment and try again." });
  }
  if (!SERVICE_KEY) {
    console.error("[demo-request] SUPABASE_SERVICE_ROLE_KEY is not set; nothing can be recorded");
    return json(origin, 503, { error: "Could not submit request. Please try again." });
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES)
      return json(origin, 413, { error: "That message is too long." });
    body = JSON.parse(text);
  } catch {
    return json(origin, 400, { error: "Could not read that request." });
  }

  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const name = str(body.name, 200);
  const email = str(body.email, 320);

  // Told plainly, because a person is looking at the form. Everything below
  // this point is silent by design; these two are not, because a visitor who
  // mistyped their address should be able to fix it.
  if (!name) return json(origin, 400, { error: "Please tell us your name." });
  if (!EMAIL.test(email)) return json(origin, 400, { error: "Please check your email address." });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { error } = await supabase.rpc("record_demo_request", {
    p_name: name,
    p_email: email,
    p_company: str(body.company, 200) || null,
    p_employees: str(body.employees, 50) || null,
    p_message: str(body.message, 5000) || null,
  });

  if (error) {
    // Logged, never shown. A Postgres message names columns and constraints,
    // which is schema disclosure and reads as gibberish to a prospect.
    console.error("[demo-request] record_demo_request failed:", error.message);
    return json(origin, 500, { error: "Could not submit request. Please try again." });
  }

  // AFTER the row is safe, and never allowed to change the answer.
  //
  // The request is recorded whatever happens next: a lead that is in the table
  // but not in an inbox is recoverable, and one the visitor was told had failed
  // is not. So this is awaited (a Deno isolate can be torn down the moment the
  // response is returned, taking a floating promise with it) and its outcome is
  // logged rather than returned.
  await notify({
    name,
    email,
    company: str(body.company, 200),
    employees: str(body.employees, 50),
    message: str(body.message, 5000),
  });

  return json(origin, 200, { ok: true });
});

/**
 * Tell somebody a demo request arrived.
 *
 * ── why this does not use the notification queue
 *
 * `notifications.organization_id` is NOT NULL and a demo request belongs to no
 * organisation, so it cannot be queued without either a fake organisation row
 * or making that column nullable — the latter being a change to RLS on a core
 * table, for one email. Recorded as a deliberate trade in D62: this path has no
 * retry and no audit trail, which is why the failure is loud in the log rather
 * than silent, and why it is the FIRST thing to move if a second platform-level
 * notification ever appears.
 *
 * ── why the address is an environment secret
 *
 * Sada's address must not be in the browser bundle, in git, or in the page —
 * a public form that renders the recipient is a form that harvests it. It lives
 * in Supabase's secret store, is read here, and never leaves this process.
 *
 * ── unconfigured is loud, not silent
 *
 * The same rule `dispatch_notifications` follows, for the same reason: the
 * defect that migration exists to fix was a delivery path that failed by doing
 * nothing at all. A missing secret says so, every time, naming what to set.
 */
async function notify(r: {
  name: string;
  email: string;
  company: string;
  employees: string;
  message: string;
}): Promise<void> {
  const to = Deno.env.get("DEMO_REQUEST_RECIPIENT") ?? "";
  const key = Deno.env.get("RESEND_API_KEY") ?? "";

  if (!to || !key) {
    console.error(
      `[demo-request] a demo request from ${r.email} was RECORDED BUT NOT EMAILED — ` +
        `${!to ? "DEMO_REQUEST_RECIPIENT" : ""}${!to && !key ? " and " : ""}${!key ? "RESEND_API_KEY" : ""} ` +
        `is not set on this project. The row is safe in demo_requests; nobody has been told about it.`,
    );
    return;
  }

  // Everything below is a stranger's input rendered into HTML. Escaped for the
  // same reason render_template() escapes (D27) — and it matters more here,
  // because the reader is Neuvto rather than a customer, and the one inbox that
  // sees every one of these is the worst place to land an injected link.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // A single-line mail header. Every C0/C1 control goes — not just CR and LF,
  // because a lone CR, a vertical tab and NEL (U+0085) are each treated as a
  // line break somewhere in a mail path — then runs of whitespace collapse and
  // the result is bounded. A 400-character subject is unreadable long before
  // any provider rejects it.
  const header = (value: string) =>
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);

  const row = (label: string, value: string) =>
    value ? `<p style="margin:0 0 6px"><strong>${label}:</strong> ${esc(value)}</p>` : "";

  const html =
    `<p style="margin:0 0 14px">A demo request came in from the website.</p>` +
    row("Name", r.name) +
    row("Email", r.email) +
    row("Company", r.company) +
    row("Employees", r.employees) +
    (r.message
      ? `<p style="margin:14px 0 6px"><strong>What they are interested in</strong></p>` +
        `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;` +
        `line-height:1.6;white-space:pre-wrap;margin:0">${esc(r.message)}</pre>`
      : "") +
    `<p style="margin:18px 0 0;color:#666;font-size:12px">` +
    `Every request is also in the <code>demo_requests</code> table, whether or not this email arrived.</p>`;

  let response: Response;
  try {
    response = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        // Reply goes to the prospect rather than to notifications@, which
        // nothing reads. The whole point of this email is to answer it.
        reply_to: r.email,
        // `header()`, not the raw value, and NOT esc() — this is the one field
        // that is not HTML.
        //
        // `esc()` covers every value in the body. The subject is a mail header,
        // and a header is terminated by CRLF: a name of
        // "Real Person\r\nBcc: attacker@evil.test" survives `.trim()` (which
        // only strips the ends) and reaches this line intact from the public
        // form. Whether Resend sanitises it is not known and is not ours to
        // rely on — a header we build is a header we clean.
        //
        // Found by db-guardian, which proved the CRLF reaches the database
        // layer as `…0d0a4263633a20…`. Reachable in production, unlike the
        // btrim finding beside it.
        subject: header(`Demo request — ${r.name}${r.company ? ` (${r.company})` : ""}`),
        html,
      }),
    });
  } catch (e) {
    console.error(
      `[demo-request] RECORDED BUT NOT EMAILED — could not reach Resend for ${r.email}:`,
      e instanceof Error ? e.message : String(e),
    );
    return;
  }

  if (!response.ok) {
    console.error(
      `[demo-request] RECORDED BUT NOT EMAILED — Resend refused ${r.email} with ` +
        `${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
}

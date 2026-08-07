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

  return json(origin, 200, { ok: true });
});

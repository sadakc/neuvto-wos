// ============================================================================
// NEUVTO WOS — notification dispatch
//
// Claims pending notifications and delivers them. Build step 5.
//
// It is deliberately dumb. Everything interesting — who to tell, which template
// wins, how it renders — happened in Postgres before a row reached this queue.
// This process turns a row into an HTTP call and records what happened, and
// that is all it should ever do.
//
// Invoked on a schedule. Safe to run concurrently with itself: the claim uses
// FOR UPDATE SKIP LOCKED, so two dispatchers never send the same email twice.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Overridable so the delivery loop can be verified end to end against a local
// stub without a live key and without sending real mail to real people.
const RESEND_BASE = Deno.env.get("RESEND_API_BASE") ?? "https://api.resend.com";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

// Not noreply@. Customers reply to these to ask questions, and a reply that
// vanishes is a poor first impression. See docs/operations/EMAIL_AND_DOMAINS.md.
const FROM = Deno.env.get("NOTIFICATION_FROM") ?? "Neuvto <notifications@neuvto.com>";
const BATCH = Number(Deno.env.get("NOTIFICATION_BATCH") ?? "25");

type Claimed = {
  id: string;
  organization_id: string;
  recipient_email: string;
  recipient_name: string | null;
  event_key: string;
  subject: string;
  body: string;
};

async function deliver(n: Claimed): Promise<{ ok: true } | { ok: false; reason: string }> {
  const to = n.recipient_name ? `${n.recipient_name} <${n.recipient_email}>` : n.recipient_email;

  let response: Response;
  try {
    response = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [to], subject: n.subject, html: n.body }),
    });
  } catch (e) {
    // The network, not the message. Left retryable rather than marked failed.
    return { ok: false, reason: `NETWORK: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (response.ok) return { ok: true };

  // Resend's body explains refusals far better than the status code does — an
  // unverified sending domain and a malformed address are both 4xx, and they
  // need completely different fixes.
  const detail = await response.text().catch(() => "");
  return { ok: false, reason: `HTTP ${response.status}: ${detail.slice(0, 400)}` };
}

Deno.serve(async (req) => {
  // The queue is not public — anyone who found this URL could otherwise drain
  // it, flushing mail early or burning the send quota.
  //
  // Authorisation is delegated to Postgres rather than checked here. The
  // EXECUTE grant on notification_claim_batch is service-role-only and the
  // harness asserts it, so presenting the wrong credential fails at the
  // database and this function needs no opinion of its own.
  //
  // The first version compared the header against SUPABASE_SERVICE_ROLE_KEY by
  // string equality. That was wrong twice over: Supabase issues both a legacy
  // JWT and a newer sb_secret_ key and only one of them matches the variable,
  // so a perfectly valid credential was refused; and it put an authorisation
  // decision in a second place, which is exactly how the two drift apart.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        hint: "Send Authorization: Bearer <service role key or secret key>.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  const callerKey = authHeader.slice("Bearer ".length).trim();

  if (!RESEND_KEY) {
    // Explicit rather than sending nothing and reporting success. A silent
    // no-op here looks identical to an empty queue, which is the hardest
    // possible thing to notice.
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY is not set — nothing can be delivered" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Built from the caller's own credential, so the claim below is attempted as
  // whoever called — which is what makes the database the authority.
  const supabase = createClient(SUPABASE_URL, callerKey);

  const { data: batch, error } = await supabase.rpc("notification_claim_batch", { _limit: BATCH });
  if (error) {
    // A refusal is a 401 and anything else is a 500. Reported distinctly
    // because "you sent the wrong key" and "the queue is broken" need
    // completely different responses, and the first version of this function
    // returned a bare "unauthorized" that could not tell them apart.
    const refused = /permission denied|not authoriz|no api key|invalid|jwt/i.test(error.message);
    return new Response(
      JSON.stringify({
        error: refused ? "unauthorized" : error.message,
        ...(refused && {
          // Deliberately does not claim the credential "is valid" — it may be
          // the wrong key, a key for a different project, or nonsense, and
          // guessing wrong sends the reader hunting in the wrong place.
          hint: "This credential is not the service role key for THIS project. Note the app runs on the Lovable Cloud project, which is not the one in your own Supabase dashboard — see docs/operations/DEPLOYMENT.md.",
        }),
      }),
      { status: refused ? 401 : 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const claimed = (batch ?? []) as Claimed[];
  let sent = 0;
  let failed = 0;

  // Sequential on purpose. The batch is small, the provider rate-limits, and a
  // burst of parallel sends buys nothing while making a 429 storm likely.
  for (const n of claimed) {
    const result = await deliver(n);
    if (result.ok) {
      await supabase.rpc("notification_mark_sent", { _id: n.id });
      sent++;
    } else {
      await supabase.rpc("notification_mark_failed", { _id: n.id, _reason: result.reason });
      failed++;
    }
  }

  return new Response(JSON.stringify({ claimed: claimed.length, sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});

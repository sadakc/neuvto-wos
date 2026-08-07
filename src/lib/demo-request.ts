import { z } from "zod";

/**
 * The public demo form's only network call.
 *
 * Replaces `demo.functions.ts`, a TanStack server function that reached for
 * `supabaseAdmin` — the only caller of the admin client in the codebase, and so
 * the only reason a service role key had to exist outside Supabase. A key that
 * bypasses row level security on every table, carried for a form that collects
 * a name and an email address from strangers.
 *
 * It now posts to the `demo-request` edge function, which holds that key and is
 * the only thing that reaches Postgres. `anon` executes nothing and no longer
 * holds any grant on `demo_requests` (20260816100000).
 *
 * A bare `fetch`, deliberately, and NOT `supabase.functions.invoke` — `invoke`
 * attaches apikey, authorization and x-client-info headers, each of which turns
 * a simple cross-origin POST into a preflighted one. That is what broke the
 * `client-error` endpoint on 6 Aug 2026: it answered curl perfectly and was
 * refused by every real browser at the preflight. There is nothing to
 * authenticate to here, so nothing is sent.
 */

/**
 * Every limit carries its own sentence.
 *
 * The `.max()` calls had none, so they fell through to Zod's default —
 * "String must contain at most 200 character(s)" — which names a type nobody
 * outside this file has heard of and does not say which field. These are shown
 * to a stranger deciding whether to talk to us, and neither input has a
 * `maxLength`, so a pasted signature block reaches them.
 */
export const DemoRequest = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please tell us your name.")
    .max(200, "That name is longer than we can store. Please shorten it."),
  email: z
    .string()
    .trim()
    .email("Please check your email address.")
    .max(320, "That email address is longer than we can store."),
  company: z
    .string()
    .trim()
    .max(200, "That company name is longer than we can store. Please shorten it.")
    .optional()
    .or(z.literal("")),
  employees: z
    .string()
    .trim()
    .max(50, "Please keep the team size short — a range like 50-200 is ideal.")
    .optional()
    .or(z.literal("")),
  message: z
    .string()
    .trim()
    .max(5000, "That message is longer than we can accept. Please shorten it.")
    .optional()
    .or(z.literal("")),
});

export type DemoRequestInput = z.infer<typeof DemoRequest>;

/**
 * Validated three times, and each pass is load-bearing rather than belt and
 * braces: here so the person sees the problem beside the field, in the edge
 * function so a hand-rolled POST cannot skip it, and in `record_demo_request`
 * because the database is the only layer that cannot be bypassed by deploying
 * an older copy of something.
 */
export async function submitDemoRequest(input: unknown): Promise<void> {
  // `safeParse`, NOT `parse` — and the difference is what a prospect sees.
  //
  // `ZodError extends Error`, so the landing page's `catch` passed
  // `err instanceof Error` and put `err.message` straight into a toast. On a
  // ZodError that property is the SERIALISED ISSUE ARRAY, so somebody typing
  // "priya@vistara" into Work email — which `type=email` happily accepts, no
  // TLD required — was shown:
  //
  //     [ { "validation": "email", "code": "invalid_string",
  //         "message": "Please check your email address.", "path": ["email"] } ]
  //
  // The sentence a person wrote was sitting inside `issues[0].message` and was
  // never reached. Also reachable with a whitespace-only name (HTML `required`
  // is satisfied by spaces), a pasted name over 200 characters, or a message
  // over 5000 — neither field has a `maxLength`. Found by screen-prover.
  //
  // Converted here rather than in the component so the local refusal and the
  // edge function's refusal arrive in the same shape: a plain Error whose
  // message is meant to be read.
  const parsed = DemoRequest.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }
  const data = parsed.data;

  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Could not submit request. Please try again.");

  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/demo-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    // Offline, DNS, a blocked request. Never the raw cause — it names hosts and
    // reads as gibberish to somebody who just wants a demo.
    throw new Error("Could not reach us just now. Please try again.");
  }

  if (response.ok) return;

  // The endpoint returns a sentence worth showing for the cases a person can
  // act on — a missing name, a mistyped address, too many attempts. Anything
  // else falls back, because a 500 body is ours to read and not theirs.
  const message = await response
    .json()
    .then((b: { error?: unknown }) => (typeof b.error === "string" ? b.error : ""))
    .catch(() => "");

  throw new Error(message || "Could not submit request. Please try again.");
}

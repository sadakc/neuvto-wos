-- Three functions resolved their names against whatever search_path the caller
-- happened to have. Now they don't.
--
-- Supabase linter 0011, function_search_path_mutable:
--   public.app_base_url
--   public.chain_condition_matches
--   public.notification_max_attempts
--
-- ── how bad is it, honestly
--
-- Not very, and saying otherwise would be as unhelpful as ignoring it. The
-- dangerous shape for a mutable search_path is SECURITY DEFINER: the function
-- runs as its owner, so persuading it to resolve `now()` or `profiles` to
-- something you control executes YOUR code as postgres. That is privilege
-- escalation.
--
-- These three are SECURITY INVOKER. They run as the caller, with the caller's
-- own rights, so bending their name resolution buys an attacker nothing they
-- could not already do directly. Every SECURITY DEFINER function in this schema
-- already pins `set search_path = public`, and a check for the ones that don't
-- returns nothing.
--
-- ── so why change them
--
-- Because all three are IMMUTABLE, and IMMUTABLE is a promise to the planner,
-- not a description. It says: for these arguments this function always returns
-- this answer, so you may constant-fold it, cache it, and index on it. A
-- function whose name resolution depends on the caller's search_path cannot
-- honestly make that promise — the same call can mean two different things to
-- two different sessions, which is precisely what an index must never be built
-- on.
--
-- Nothing indexes them today. `chain_condition_matches` decides approval
-- routing, `app_base_url` builds the links in outgoing email, and
-- `notification_max_attempts` bounds the retry loop — all three are the kind of
-- small pure helper that ends up inside a generated column or a constraint the
-- moment somebody needs it there, and the promise should be true before that
-- happens rather than after.
--
-- ── ALTER, not CREATE OR REPLACE
--
-- Changing one property should not mean retyping a body. Re-declaring a
-- function to adjust its search_path is how a body silently drifts from the
-- version that was reviewed — the diff looks like a one-line change and isn't.
-- ALTER FUNCTION touches the property and nothing else.

alter function public.app_base_url()
  set search_path = public;

alter function public.chain_condition_matches(_context jsonb, _field text, _op text, _value numeric)
  set search_path = public;

alter function public.notification_max_attempts()
  set search_path = public;

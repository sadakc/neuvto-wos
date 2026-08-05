-- ============================================================================
-- NEUVTO WOS — how long a session lasts, and who decides
--
-- D20 shipped its storage in Phase 0 and nothing else:
--
--     session_idle_minutes    integer not null default 60,   -- D20
--     session_absolute_hours  integer not null default 24,   -- D20
--
-- Both columns exist, both are constrained, both are read into `OrgSettings` in
-- the client — and `saveOrgSettings` has never written either, no screen has
-- ever shown them, and nothing has ever enforced them. A session in this product
-- has, until today, lasted forever: `autoRefreshToken` with a rotating refresh
-- token in localStorage renews itself indefinitely.
--
-- This is the read side. The browser enforces it (see src/platform/auth/idle.ts,
-- and read the "Where this stands" block in NEUVTO_SECURITY_POLICY.md before
-- believing that is the same as enforcement).
--
-- ── why a function and not a settings read
--
-- Two reasons, and the second is the one that matters.
--
-- Neuvto staff have NO `organization_settings` row. They have no profile at all
-- — that absence is what makes every tenant policy refuse them (D42) — so
-- `getOrgSettings()` returns null for them under RLS. A client that fell back to
-- a constant there would be hardcoding the number this migration exists to stop
-- hardcoding, and it would do it for the account with the most power.
--
-- And the policy is not a property of the organisation alone. See below.
--
-- ── THE ASYMMETRY, which is D21's argument applied to a second thing
--
-- The security policy already reasons this way about MFA:
--
--     "Forcing an authenticator app on a security guard checking their holiday
--      allowance buys nothing and costs adoption; not forcing it on the person
--      who can export the whole workforce is negligent."
--
-- Session length is the same question. An org_admin can export every employee
-- record and change who approves what. An employee can see their own leave
-- balance. Giving both the same thirty minutes is not "consistent", it is
-- refusing to think about it twice.
--
-- And the cost is not hypothetical. The employee app is mobile-first, installed
-- as a PWA, and sign-in is email OTP with no password, no biometric and no
-- "remember this device". A thirty-minute idle limit means a guard who
-- backgrounds the app over lunch must leave it, open their email, find a code
-- and type six digits — several times a day, on the app D1 describes as "the
-- HRMS your employees actually open".
--
-- So: 30 minutes where the damage is large, 8 hours where it is one person's own
-- balance. The absolute cap still bounds everybody.
--
-- ── what this does NOT do
--
-- It does not shorten any token's life. It does not revoke anything. It answers
-- a question the browser asks, and a browser can be closed, scripted, or simply
-- told to ignore the answer. It is a control against an unattended screen, which
-- is a real threat for shop-floor terminals and shared tablets, and it is not a
-- control against anybody holding the refresh token.
-- ============================================================================

-- ── the default, corrected
--
-- 60 was a placeholder nobody chose; 30 is the decision (4 Aug 2026). The
-- backfill is scoped to rows still holding the old default, which today is every
-- row precisely because `saveOrgSettings` never wrote the column — so no
-- deliberate choice can be stamped on. Scoped anyway, so that re-running this
-- after the settings UI ships still cannot overwrite somebody's answer.
alter table public.organization_settings
  alter column session_idle_minutes set default 30;

update public.organization_settings
   set session_idle_minutes = 30
 where session_idle_minutes = 60;

comment on column public.organization_settings.session_idle_minutes is
  'Idle timeout for admins and managers in this organisation. Employees get the longer platform default — see session_policy(). Read by the browser; not enforced server-side.';

-- ─────────────────────────────────────────────────────────────── the policy

create or replace function public.session_policy()
returns table (idle_minutes integer, absolute_hours integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  -- Raises rather than returning a default. A caller with no session asking how
  -- long its session lasts is a bug, and answering "30" would let it run a timer
  -- against nothing — which looks like it works right up until it matters.
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  -- Staff first, and deliberately so: a platform admin has no profile, so every
  -- lookup below returns null for them. Checking them last would mean falling
  -- through to a default, which is how the account that provisions customers
  -- would quietly get the most generous policy in the system.
  --
  -- 8 hours absolute rather than 24: staff hold provisioning powers and read no
  -- tenant data, so a long session buys them nothing and costs the most.
  if public.is_platform_admin() then
    return query select 30, 8;
    return;
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    -- Authenticated, no workspace: an invitation not yet accepted, or somebody
    -- deactivated. They can reach almost nothing, but the browser still needs a
    -- number to run its timer against, and it should be the tight one.
    return query select 30, 8;
    return;
  end if;

  return query
  select
    case
      -- Roles come from user_roles, never a column on the profile (D4) — a role
      -- on a user-editable row is a privilege-escalation hole.
      --
      -- `exists` rather than a join: somebody holding two roles must get the
      -- tighter policy, not two rows or an arbitrary one.
      when exists (
        select 1 from public.user_roles ur
         where ur.user_id = v_uid
           and ur.organization_id = v_org
           and ur.deleted_at is null
           and ur.role in ('org_admin', 'hr_admin', 'manager')
      ) then s.session_idle_minutes
      -- An employee, and nothing more. Their own balance, their own requests.
      -- 8 hours covers a shift without a re-authentication in the middle of it.
      else greatest(s.session_idle_minutes, 480)
    end,
    s.session_absolute_hours
  from public.organization_settings s
  where s.organization_id = v_org;

  -- An organisation with no settings row cannot happen — provisioning creates
  -- one — but "cannot happen" is how a browser ends up running a timer against
  -- NaN and logging somebody out on the first tick.
  if not found then
    return query select 30, 24;
  end if;
end $function$;

comment on function public.session_policy is
  'How long this caller''s session may idle, and its absolute cap. Admins and managers get the organisation''s setting (30 by default); an employee gets at least 8 hours, because the app is mobile-first with email-OTP sign-in and re-authenticating a guard mid-shift costs adoption and buys nothing (the D21 argument, applied to session length). Platform admins get 30/8 and have no organisation row at all (D42).';

-- Born ungranted: 20260808100000_anon_executes_nothing.sql revoked execute from
-- every function in `public` and grants back an explicit list, and set the
-- default privileges so new functions start closed. `anon` never gets this — a
-- caller with no session raises above, and asking the question at all requires
-- being somebody.
revoke all on function public.session_policy() from public, anon;
grant execute on function public.session_policy() to authenticated;

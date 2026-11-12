-- Sada, 3 Nov 2026 (D118): somebody invited decides not to join, or never got
-- the email. The admin withdraws the invitation, or sends a fresh one, from the
-- person's own card as well as from People › Waiting to join.
--
--   · Withdrawing puts the record back to a draft: its name, email, mobile,
--     joining date, department and manager are the draft's again, to be
--     corrected and invited again, or left. Until now People's Withdraw
--     revoked the invitation and left the record "Invited" by a dead link,
--     with no way to invite them again.
--   · A fresh invitation withdraws the old one (its link stops working) and
--     sends a new one with the same details, through the one way in (D110).

-- ═══════════════════════════════════════════════════════ 1 · back to a draft

/** The record an invitation was sent from, made a draft again. Internal. */
create or replace function public.employee_invite_back_to_draft(_invitation_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv public.invitations%rowtype;
  v_emp uuid;
begin
  select * into v_inv from public.invitations where id = _invitation_id;
  select id into v_emp from public.employees
   where invitation_id = _invitation_id and profile_id is null and deleted_at is null;
  if v_emp is null then
    return null;
  end if;
  update public.employees set
    invitation_id       = null,
    draft_full_name     = coalesce(v_inv.full_name, v_inv.email),
    draft_email         = v_inv.email,
    draft_phone         = v_inv.phone,
    draft_joined_date   = v_inv.joined_date,
    draft_department_id = v_inv.department_id,
    draft_manager_id    = (select p.id from public.profiles p
                            where p.organization_id = v_inv.organization_id
                              and lower(p.email) = lower(v_inv.manager_email)
                              and p.deleted_at is null limit 1)
   where id = v_emp;
  return v_emp;
end $$;

revoke all on function public.employee_invite_back_to_draft(uuid) from public, anon, authenticated;

-- People's Withdraw does the same now.
do $$
declare
  v_def text := pg_get_functiondef('public.invitation_revoke(uuid)'::regprocedure);
  v_anchor text := $q$  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0001';
  end if;
$q$;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'invitation_revoke no longer ends as expected; restate it here';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $q$  -- D118. The record it was sent from is a draft again, to invite again or leave.
  perform public.employee_invite_back_to_draft(_id);
$q$);
end $$;

-- Records already left behind by a withdrawn invitation.
do $$
declare r record;
begin
  for r in select e.invitation_id from public.employees e
             join public.invitations i on i.id = e.invitation_id
            where e.profile_id is null and e.deleted_at is null and i.revoked_at is not null
  loop
    perform public.employee_invite_back_to_draft(r.invitation_id);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════ 2 · from the card

/** Withdraw the invitation waiting on this record; the record is a draft again. */
create or replace function public.employee_withdraw_invite(_employee_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv uuid;
begin
  perform public.employee_require_admin(_employee_id);
  select i.id into v_inv from public.employees e join public.invitations i on i.id = e.invitation_id
   where e.id = _employee_id and e.profile_id is null
     and i.accepted_at is null and i.revoked_at is null and i.deleted_at is null;
  if v_inv is null then
    raise exception 'NO_INVITATION_WAITING' using errcode = 'P0001';
  end if;
  update public.invitations set revoked_at = now() where id = v_inv;
  perform public.employee_invite_back_to_draft(v_inv);
end $$;

revoke all on function public.employee_withdraw_invite(uuid) from public, anon;
grant execute on function public.employee_withdraw_invite(uuid) to authenticated;

/**
 * A fresh invitation for this record: the waiting one is withdrawn (its link
 * stops working) and a new one is sent, with the same details and role.
 * Returns the new invitation.
 */
create or replace function public.employee_resend_invite(_employee_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  perform public.employee_require_admin(_employee_id);
  select i.role into v_role from public.employees e join public.invitations i on i.id = e.invitation_id
   where e.id = _employee_id and e.profile_id is null
     and i.accepted_at is null and i.revoked_at is null and i.deleted_at is null;
  if v_role is null then
    raise exception 'NO_INVITATION_WAITING' using errcode = 'P0001';
  end if;
  perform public.employee_withdraw_invite(_employee_id);
  return public.employee_send_invite(_employee_id, v_role);
end $$;

revoke all on function public.employee_resend_invite(uuid) from public, anon;
grant execute on function public.employee_resend_invite(uuid) to authenticated;

/** People's Send again: the same, from the invitation. */
create or replace function public.invitation_resend(_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  if public.current_org_id() is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select e.id into v_emp from public.employees e join public.invitations i on i.id = e.invitation_id
   where i.id = _id and i.organization_id = public.current_org_id() and e.profile_id is null;
  if v_emp is null then
    -- From before invitations came from a record (D110): invite them from theirs.
    raise exception 'INVITE_FROM_THE_RECORD' using errcode = 'P0001';
  end if;
  return public.employee_resend_invite(v_emp);
end $$;

revoke all on function public.invitation_resend(uuid) from public, anon;
grant execute on function public.invitation_resend(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════ 3 · the card offers them

do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_old text := $q$    'canSendInvite', admin_ and v_p.id is null and v_inv.id is null and v_e.draft_full_name is not null,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_card no longer offers Send invite as expected; restate it here';
  end if;
  execute replace(v_def, v_old, v_old || $q$
    -- D118. An invitation waiting: withdrawn, or sent afresh.
    'canWithdrawInvite', admin_ and v_p.id is null and v_inv.id is not null
                         and v_inv.accepted_at is null and v_inv.revoked_at is null,
    'invitationExpiresAt', case when v_p.id is null and v_inv.accepted_at is null and v_inv.revoked_at is null
                                then v_inv.expires_at end,$q$);
end $$;

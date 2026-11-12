-- Sada, 14 Oct 2026 (D113): what he found testing on his phone.
--
--   1 · "This year" said a leave Mark had approved was still awaiting a
--       decision. leave_balances keeps three buckets: reserved (sent, not yet
--       decided), pending (approved, still ahead) and used (taken). The card
--       read pending as "awaiting a decision". It reads reserved now, and says
--       the approved-but-ahead days for what they are.
--   2 · Kavya, deployed from a date still to come, showed no unit at all. The
--       card already sent the coming posting; it now sends its unit type too, so
--       the card can show it in full until it starts.
--   3 · A change request is approved now, not "made" (the button says Approve),
--       and a declined one carries its reason in the bell as well as the email.

-- ═══════════════════════════════════════════════════════ 1 · awaiting, and approved ahead

do $$
declare
  v_def text := pg_get_functiondef('public.employee_this_year(uuid)'::regprocedure);
  v_old text := $q$             'pending',     coalesce(b.pending_days, 0),$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_this_year no longer reads pending as expected; restate it here';
  end if;
  execute replace(v_def, v_old, $q$             -- D113. Sent and not yet decided is reserved; approved and
             -- still ahead is pending. "Awaiting a decision" is the first.
             'pending',     coalesce(b.reserved_days, 0),
             'booked',      coalesce(b.pending_days, 0),$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 2 · the coming posting, in full

do $$
declare
  v_def text := pg_get_functiondef('public.employee_card(uuid)'::regprocedure);
  v_old text := $q$jsonb_build_object('unitName', u.name, 'effectiveFrom', d.effective_from)$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_card no longer builds the coming posting as expected; restate it here';
  end if;
  execute replace(v_def, v_old,
    $q$jsonb_build_object('unitName', u.name, 'effectiveFrom', d.effective_from, 'unitType', u.unit_type)$q$);
end $$;

-- ═══════════════════════════════════════════════════════ 3 · approved, and why not

do $$
declare
  v_def text := pg_get_functiondef('public.employee_resolve_change(uuid,text,text)'::regprocedure);
  v_old text := $q$    'outcome',         case _outcome when 'done' then 'made' else 'declined' end,
    'note',            coalesce(nullif(btrim(_note), ''), 'No note was added.')$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'employee_resolve_change no longer tells the person as expected; restate it here';
  end if;
  execute replace(v_def, v_old, $q$    'outcome',         case _outcome when 'done' then 'approved' else 'declined' end,
    'note',            coalesce(nullif(btrim(_note), ''), 'No note was added.'),
    -- D113. The bell shows a reason under the notice; a decline always has one.
    'reason',          case when _outcome = 'declined' then btrim(_note) end$q$);
end $$;

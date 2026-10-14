-- NEUVTO WOS — the bell (D111)
--
-- Raises on the first violation. Silence means pass. Rolled back.
--
-- PHASE-AWARE: exits quietly if notifications_feed() does not exist yet.
--
--   whose        a person's bell lists their own notices only, an admin's too;
--                they mark only their own as read;
--   what         whatever the engine already tells them (a change request,
--                emailed) is in the bell as well; a notice with no template
--                is not;
--   own changes  a person changing their own record tells the Employee
--                Admins, in the bell and never by email; an Admin's edit, a
--                refused save and a save that changes nothing tell nobody;
--   everybody    (D112) somebody who neither approves nor administers hears
--                of their own: what they raised is waiting for somebody, and
--                what their own record still needs that is theirs to give,
--                once a reminder period, never the company's own items.

begin;

create or replace function pg_temp.nb_as(_uid uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
end $$ language plpgsql;

create or replace function pg_temp.nb_root() returns void as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$ language plpgsql;

create or replace function pg_temp.nb_val(_uid uuid, _sql text) returns text as $$
declare v text;
begin
  perform pg_temp.nb_as(_uid);
  execute _sql into v;
  perform pg_temp.nb_root();
  return v;
exception when others then
  perform pg_temp.nb_root();
  raise exception 'BELL FAIL: refused: % — %', _sql, sqlerrm;
end $$ language plpgsql;

create or replace function pg_temp.nb_try(_uid uuid, _sql text) returns void as $$
begin
  perform pg_temp.nb_as(_uid);
  begin
    execute _sql;
  exception when others then null;
  end;
  perform pg_temp.nb_root();
end $$ language plpgsql;

create or replace function pg_temp.nb_check(_label text, _got text, _want text) returns void as $$
begin
  if _got is distinct from _want then
    raise exception 'BELL FAIL: % — got %, wanted %', _label, _got, _want;
  end if;
  raise notice 'ok: %', _label;
end $$ language plpgsql;

do $$
declare
  acme  uuid := '00000000-0000-0000-0000-0000000000a0';
  alice uuid := '00000000-0000-0000-0000-00000000a001';  -- Super Admin
  hema  uuid := '00000000-0000-0000-0000-00000000a002';  -- Employee Admin
  ravi  uuid := '00000000-0000-0000-0000-00000000a005';
  priya uuid := '00000000-0000-0000-0000-00000000a006';
  e_ravi uuid;
  own   text := $q$select count(*)::text from public.notifications_feed(100) where event_key = 'employee.changed_own_record'$q$;
  first_id uuid;
begin
  if to_regprocedure('public.notifications_feed(integer)') is null then
    raise notice 'skip: no bell yet';
    return;
  end if;
  insert into public.organization_modules (organization_id, module_key, enabled, enabled_at)
  values (acme, 'employee', true, now())
  on conflict (organization_id, module_key) do update set enabled = true, deleted_at = null;
  select id into e_ravi from public.employees where profile_id = ravi;
  delete from public.employee_field_settings where organization_id = acme;
  -- Start everybody's bell empty, whatever the local copy holds.
  delete from public.notifications where organization_id = acme;

  -- ── own changes
  perform pg_temp.nb_val(ravi, format($q$select public.employee_update(%L, '{"alternateMobile":"9876500077"}')::text$q$, e_ravi));
  perform pg_temp.nb_check('the Employee Admin is told when a person changes their own record',
    pg_temp.nb_val(hema, own), '1');
  perform pg_temp.nb_check('and so is the Super Admin',
    pg_temp.nb_val(alice, own), '1');
  perform pg_temp.nb_check('in words that say who and what',
    pg_temp.nb_val(hema, $q$select subject from public.notifications_feed(1)$q$),
    'Ravi Employee changed their alternate mobile number');
  perform pg_temp.nb_check('with the record it is about, to open',
    pg_temp.nb_val(hema, $q$select payload ->> 'employee_id' from public.notifications_feed(1)$q$), e_ravi::text);
  perform pg_temp.nb_check('the person is not told of their own change',
    pg_temp.nb_val(ravi, own), '0');
  perform pg_temp.nb_check('it is in the bell only, never queued as an email',
    (select string_agg(distinct channel::text || '/' || status::text, ',') from public.notifications
      where event_key = 'employee.changed_own_record'), 'in_app/sent');

  perform pg_temp.nb_val(hema, format($q$select public.employee_update(%L, '{"alternateMobile":"9876500088"}')::text$q$, e_ravi));
  perform pg_temp.nb_check('an Admin''s own edit tells nobody',
    pg_temp.nb_val(alice, own), '1');
  perform pg_temp.nb_try(ravi, format($q$select public.employee_update(%L, '{"sex":"male"}')$q$, e_ravi));
  perform pg_temp.nb_check('a refused save tells nobody',
    pg_temp.nb_val(hema, own), '1');
  -- His family, sent back exactly as it is.
  insert into public.family_members (organization_id, employee_id, relation, name, date_of_birth, sort_order)
  values (acme, e_ravi, 'son', 'Arjun Kumar', '2015-05-05', 0);
  perform pg_temp.nb_val(ravi, format($q$select public.employee_save_family(%L, %L)::text$q$, e_ravi,
    (select jsonb_agg(jsonb_build_object('id', id, 'relation', relation, 'name', name,
       'dateOfBirth', date_of_birth, 'isDependent', is_dependent) order by sort_order)
       from public.family_members where employee_id = e_ravi)));
  perform pg_temp.nb_check('a save that changes nothing tells nobody',
    pg_temp.nb_val(hema, own), '1');

  -- ── what else is there
  perform pg_temp.nb_val(ravi, format($q$select public.employee_request_change(%L, 'contact', 'My mobile number is wrong')::text$q$, e_ravi));
  -- One transaction gives every row the same time; in use, each is its own.
  update public.notifications set created_at = created_at + interval '1 minute'
   where event_key = 'employee.change_requested';
  perform pg_temp.nb_check('a change request is in the admins'' bell as well as their email',
    pg_temp.nb_val(hema, $q$select count(*)::text from public.notifications_feed(100) where event_key = 'employee.change_requested'$q$), '1');
  insert into public.notifications (organization_id, recipient_id, event_key, channel, payload, subject, body, status, failed_reason)
  values (acme, hema, 'nothing.known', 'email', '{}', '(no template)', '(no template)', 'failed', 'NO_TEMPLATE');
  perform pg_temp.nb_check('a notice with no template is not listed',
    pg_temp.nb_val(hema, $q$select count(*)::text from public.notifications_feed(100) where event_key = 'nothing.known'$q$), '0');

  -- ── whose
  perform pg_temp.nb_check('an admin''s bell is their own, not everybody''s',
    pg_temp.nb_val(hema, $q$select count(*)::text from public.notifications_feed(100) n
       join public.notifications x on x.id = n.id where x.recipient_id <> auth.uid()$q$), '0');
  perform pg_temp.nb_check('the newest is first',
    pg_temp.nb_val(hema, $q$select event_key from public.notifications_feed(1)$q$), 'employee.change_requested');
  perform pg_temp.nb_check('two unread',
    pg_temp.nb_val(hema, 'select public.notifications_unread()::text'), '2');
  select id into first_id from public.notifications
   where recipient_id = hema and event_key = 'employee.change_requested';
  perform pg_temp.nb_check('somebody else cannot mark it read',
    pg_temp.nb_val(priya, format('select public.notifications_mark_read(array[%L]::uuid[])::text', first_id)), '0');
  perform pg_temp.nb_check('the recipient can, one at a time',
    pg_temp.nb_val(hema, format('select public.notifications_mark_read(array[%L]::uuid[])::text', first_id)), '1');
  perform pg_temp.nb_check('which leaves one unread',
    pg_temp.nb_val(hema, 'select public.notifications_unread()::text'), '1');
  perform pg_temp.nb_check('and opened, it says when',
    pg_temp.nb_val(hema, format($q$select (read_at is not null)::text from public.notifications_feed(100) where id = %L$q$, first_id)), 'true');
  perform pg_temp.nb_check('all at once',
    pg_temp.nb_val(hema, 'select public.notifications_mark_read(null)::text'), '1');
  perform pg_temp.nb_check('and none are left',
    pg_temp.nb_val(hema, 'select public.notifications_unread()::text'), '0');
  perform pg_temp.nb_check('Alice''s are still unread',
    pg_temp.nb_val(alice, 'select (public.notifications_unread() > 0)::text'), 'true');

  -- ── D112 · everybody's own
  if to_regprocedure('public.employee_remind_people(uuid,integer)') is not null then
    delete from public.notifications where organization_id = acme;
    declare
      v_day date := public.org_today(acme) + 40;
    begin
      while extract(isodow from v_day) > 5 loop v_day := v_day + 1; end loop;
      perform pg_temp.nb_val(ravi, format(
        $q$select public.leave_submit('00000000-0000-0000-0000-0000000000c1', %L, %L, 'Family visit')::text$q$,
        v_day, v_day));
    end;
    perform pg_temp.nb_check('what you raised is in your own bell, with who it waits for',
      pg_temp.nb_val(ravi, $q$select subject from public.notifications_feed(10) where event_key = 'approval.sent'$q$),
      'Your leave request is waiting for Mark Manager');
    perform pg_temp.nb_check('in the bell only',
      (select string_agg(distinct channel::text || '/' || status::text, ',') from public.notifications
        where event_key = 'approval.sent'), 'in_app/sent');
    perform pg_temp.nb_check('the approver is told it needs them, not that it was sent',
      pg_temp.nb_val('00000000-0000-0000-0000-00000000a004',
        $q$select string_agg(event_key, ',') from public.notifications_feed(10)$q$), 'approval.submitted');
    perform pg_temp.nb_check('and a colleague hears nothing of it',
      pg_temp.nb_val(priya, 'select count(*)::text from public.notifications_feed(100)'), '0');

    update public.employees set date_of_birth = null, emergency_contact_name = null,
           emergency_contact_relation = null, emergency_contact_phone = null, designation_id = null
     where id = e_ravi;
    perform public.employee_remind_people(acme, 3);
    perform pg_temp.nb_check('what your own record needs is in your bell',
      pg_temp.nb_val(ravi, $q$select count(*)::text from public.notifications_feed(10) where event_key = 'employee.your_record_needs'$q$), '1');
    perform pg_temp.nb_check('the things that are yours to give',
      pg_temp.nb_val(ravi, $q$select (subject like '%date of birth%' and subject like '%emergency contact%')::text
                               from public.notifications_feed(10) where event_key = 'employee.your_record_needs'$q$), 'true');
    perform pg_temp.nb_check('never the company''s own items',
      pg_temp.nb_val(ravi, $q$select (subject like '%designation%')::text
                               from public.notifications_feed(10) where event_key = 'employee.your_record_needs'$q$), 'false');
    perform public.employee_remind_people(acme, 3);
    perform pg_temp.nb_check('once a reminder period, not every run',
      pg_temp.nb_val(ravi, $q$select count(*)::text from public.notifications_feed(10) where event_key = 'employee.your_record_needs'$q$), '1');
    -- And it comes from the daily onboarding run, on the company's cadence.
    delete from public.notifications where event_key = 'employee.your_record_needs';
    delete from public.employee_onboarding_reminders where organization_id = acme;
    perform public.employee_onboarding_remind_due();
    perform pg_temp.nb_check('the daily onboarding run tells the person',
      pg_temp.nb_val(ravi, $q$select count(*)::text from public.notifications_feed(10) where event_key = 'employee.your_record_needs'$q$), '1');
    perform pg_temp.nb_check('only to the person themselves',
      (select count(*)::text from public.notifications
        where event_key = 'employee.your_record_needs' and payload ->> 'employee_id' = e_ravi::text
          and recipient_id <> ravi), '0');
  else
    raise notice 'skip: no reminders for people yet';
  end if;
end $$;

rollback;

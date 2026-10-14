-- Sada's fourth round (D106): designations in an order the company decides.
--
-- A designation carries a rank, 1 the most senior. Every list a designation
-- is chosen from reads in rank order, so the company's hierarchy is what the
-- dropdown shows, top first. An Admin reorders the whole list at once; a new
-- designation joins at the bottom until it is moved.

alter table public.designations add column rank integer;

comment on column public.designations.rank is
  'D106: the company''s order, 1 the most senior. Lists read in this order. Set by employee_rank_designations; a new one joins at the bottom.';

-- Existing lists keep the order they were shown in, alphabetical.
update public.designations d set rank = s.r
  from (select id, row_number() over (partition by organization_id order by lower(name)) as r
          from public.designations) s
 where s.id = d.id;

create or replace function public.tf_designation_joins_at_the_bottom()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rank is null then
    new.rank := coalesce((select max(rank) from public.designations
                           where organization_id = new.organization_id), 0) + 1;
  end if;
  return new;
end $$;

revoke all on function public.tf_designation_joins_at_the_bottom() from public, anon, authenticated;

create trigger joins_at_the_bottom
  before insert on public.designations
  for each row execute function public.tf_designation_joins_at_the_bottom();

-- The whole list, in its new order: every designation the company has, each
-- once. A partial list would leave two at one rank, so it is refused.
create or replace function public.employee_rank_designations(_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.employee_require_config_admin();
  v_all int;
begin
  select count(*) into v_all from public.designations
   where organization_id = v_org and deleted_at is null;
  if _ids is null or cardinality(_ids) <> v_all
     or (select count(distinct x) from unnest(_ids) x) <> v_all
     or exists (select 1 from unnest(_ids) x
                 where not exists (select 1 from public.designations d
                                    where d.id = x and d.organization_id = v_org and d.deleted_at is null)) then
    raise exception 'ORDER_INCOMPLETE' using errcode = 'P0001',
      hint = 'Send every designation once, in the new order.';
  end if;
  update public.designations d set rank = array_position(_ids, d.id)
   where d.organization_id = v_org and d.id = any (_ids);
end $$;

revoke all on function public.employee_rank_designations(uuid[]) from public, anon;
grant execute on function public.employee_rank_designations(uuid[]) to authenticated;

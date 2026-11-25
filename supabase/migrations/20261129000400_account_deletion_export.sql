-- Account deletion and data export (required by the app stores; also the right
-- thing to offer). Documented exception to "never hard-delete": a person who asks
-- to delete their account is really removed after a 30-day grace period.
--
--  * Labs where they are an ordinary member, or one of several owners: they leave
--    straight away. Their records stay, with their initials on the labels.
--  * A lab where they are the only owner AND others belong: refused until they
--    make someone else an owner (or remove the others).
--  * A lab where they are alone: kept for 30 days (they can cancel), then deleted
--    with the account.

create table public.deletion_requests (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  requested_at  timestamptz not null default now(),
  purge_after   timestamptz not null default now() + interval '30 days'
);
alter table public.deletion_requests enable row level security;
create policy "read own request" on public.deletion_requests for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.deletion_requests from anon, authenticated;
grant select on public.deletion_requests to authenticated;

create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  m      record;
  v_after timestamptz;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  for m in select mm.account_id, mm.role, a.name from public.members mm join public.accounts a on a.id = mm.account_id where mm.user_id = v_user loop
    if m.role = 'owner' and private.other_owners(m.account_id, v_user) = 0
       and exists (select 1 from public.members x where x.account_id = m.account_id and x.user_id <> v_user) then
      raise exception 'Make someone else an owner of "%" first, or remove the other people, then try again.', m.name using errcode = 'P0001';
    end if;
  end loop;

  -- Leave every lab that will carry on without them.
  delete from public.members mm
  where mm.user_id = v_user
    and (mm.role <> 'owner' or private.other_owners(mm.account_id, v_user) > 0
         or exists (select 1 from public.members x where x.account_id = mm.account_id and x.user_id <> v_user));
  -- (a lab they own alone is the only kind left)

  insert into public.deletion_requests (user_id) values (v_user)
  on conflict (user_id) do nothing;
  select purge_after into v_after from public.deletion_requests where user_id = v_user;
  return v_after;
end;
$$;

create function public.cancel_account_deletion()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.deletion_requests where user_id = (select auth.uid());
$$;

-- Removes one person for good: labs they were alone in, then the account itself.
-- A lab that gained members during the grace period passes to its longest-standing
-- member rather than disappearing.
create function private.purge_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in select account_id from public.members where user_id = p_user loop
    if exists (select 1 from public.members x where x.account_id = m.account_id and x.user_id <> p_user) then
      if private.other_owners(m.account_id, p_user) = 0 then
        update public.members set role = 'owner'
        where (account_id, user_id) = (
          select x.account_id, x.user_id from public.members x
          where x.account_id = m.account_id and x.user_id <> p_user order by x.created_at limit 1);
      end if;
    else
      delete from public.accounts where id = m.account_id;
    end if;
  end loop;
  delete from auth.users where id = p_user;
end;
$$;

create function private.purge_due_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select user_id from public.deletion_requests where purge_after <= now() loop
    perform private.purge_account(r.user_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- For the back office, or to run by hand.
create function public.admin_purge_due_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  perform private.require_admin();
  n := private.purge_due_accounts();
  perform private.audit('purge_due_accounts', null, jsonb_build_object('purged', n));
  return n;
end;
$$;

-- Everything in one lab, as JSON, for the person to keep. Runs as the caller, so
-- row-level security limits it to labs they belong to. Removed rows are included.
create function public.export_lab(p_account_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_member(p_account_id) then
    raise exception 'Not a member of this lab' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'lab', (select to_jsonb(a) from public.accounts a where a.id = p_account_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('initials', m.initials, 'role', m.role, 'joined', m.created_at) order by m.created_at), '[]') from public.members m where m.account_id = p_account_id),
    'strains', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.strains t where t.account_id = p_account_id),
    'cultures', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.code), '[]') from public.items t where t.account_id = p_account_id),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at), '[]') from public.events t where t.account_id = p_account_id),
    'media_batches', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.media_batches t where t.account_id = p_account_id),
    'sterilization_runs', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.sterilization_runs t where t.account_id = p_account_id),
    'recipes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.recipes t where t.account_id = p_account_id),
    'colonization_checks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.colonization_checks t where t.account_id = p_account_id),
    'technique_changes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]') from public.technique_changes t where t.account_id = p_account_id)
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['request_account_deletion()', 'cancel_account_deletion()', 'admin_purge_due_accounts()', 'export_lab(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.purge_account(uuid), private.purge_due_accounts() from public, anon, authenticated;

-- Run the purge every day where pg_cron exists (Supabase has it; skipped elsewhere).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-deleted-accounts', '17 4 * * *', 'select private.purge_due_accounts()');
  end if;
exception when others then
  raise notice 'pg_cron not set up (%); run admin_purge_due_accounts() by hand or schedule it', sqlerrm;
end $$;

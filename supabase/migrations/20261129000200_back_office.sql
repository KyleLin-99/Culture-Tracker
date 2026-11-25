-- Back office (docs/PLANS.md): platform admins manage people, plans, the waitlist,
-- app settings and feature flags. Everything goes through security definer
-- functions that check private.is_platform_admin() FIRST and write admin_audit.
-- They return counts and account facts only; no culture, strain or lab records.

create table public.admin_audit (
  id           bigint generated always as identity primary key,
  admin_id     uuid not null,
  action       text not null,
  target_user  uuid,
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
alter table public.admin_audit enable row level security;  -- no policies: functions only
revoke all on public.admin_audit from anon, authenticated;

create table public.feature_flags (
  key               text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled           boolean not null default false,
  early_access_only boolean not null default true,
  description       text not null default ''
);
alter table public.feature_flags enable row level security;
create policy "signed in read flags" on public.feature_flags for select to authenticated using (true);
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to authenticated;

create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Only the app''s administrators can do this' using errcode = '42501';
  end if;
end;
$$;

create function private.audit(p_action text, p_target uuid, p_detail jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit (admin_id, action, target_user, detail)
  values ((select auth.uid()), p_action, p_target, coalesce(p_detail, '{}'));
$$;

-- Whether to show the back-office entry. Anyone signed in may ask about themselves.
create function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_platform_admin(); $$;

create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'max_users', coalesce((private.setting('max_users'))::int, 25),
    'signups_open', coalesce((private.setting('signups_open'))::boolean, true),
    'min_app_version', coalesce(private.setting('min_app_version') #>> '{}', '0.0.0'),
    'message', coalesce(private.setting('maintenance_message') #>> '{}', ''),
    'labs', (select count(*) from public.accounts),
    'waitlist_pending', (select count(*) from public.waitlist where approved_at is null),
    'by_tier', (select coalesce(jsonb_object_agg(tier, n), '{}') from (select tier, count(*) n from public.profiles group by tier) t)
  );
end;
$$;

create function public.admin_list_users(p_search text default '')
returns table (user_id uuid, email text, tier text, early_access boolean, is_admin boolean,
               created_at timestamptz, last_sign_in_at timestamptz, labs_owned bigint, labs_joined bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select u.id, u.email::text, p.tier, p.early_access,
           exists (select 1 from public.platform_admins a where a.user_id = u.id),
           u.created_at, u.last_sign_in_at,
           (select count(*) from public.members m where m.user_id = u.id and m.role = 'owner'),
           (select count(*) from public.members m where m.user_id = u.id and m.role <> 'owner')
    from auth.users u join public.profiles p on p.user_id = u.id
    where coalesce(p_search, '') = '' or u.email ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%'
    order by u.created_at desc
    limit 200;
end;
$$;

create function public.admin_set_tier(p_user_id uuid, p_tier text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_old text;
begin
  perform private.require_admin();
  if p_tier not in ('standard', 'paid1', 'paid2', 'special') then
    raise exception 'Plan is standard, paid1, paid2 or special' using errcode = '22023';
  end if;
  select tier into v_old from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'No such person' using errcode = 'P0002'; end if;
  update public.profiles set tier = p_tier where user_id = p_user_id;
  perform private.audit('set_tier', p_user_id, jsonb_build_object('from', v_old, 'to', p_tier));
end;
$$;

create function public.admin_set_early_access(p_user_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.profiles set early_access = coalesce(p_on, false) where user_id = p_user_id;
  if not found then raise exception 'No such person' using errcode = 'P0002'; end if;
  perform private.audit('set_early_access', p_user_id, jsonb_build_object('on', coalesce(p_on, false)));
end;
$$;

create function public.admin_list_waitlist()
returns table (id uuid, email text, created_at timestamptz, approved_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select w.id, w.email, w.created_at, w.approved_at from public.waitlist w order by w.created_at limit 500;
end;
$$;

create function public.admin_approve_waitlist(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_email text;
begin
  perform private.require_admin();
  update public.waitlist set approved_at = now() where id = p_id and approved_at is null returning email into v_email;
  if not found then raise exception 'Not on the waitlist, or already approved' using errcode = 'P0002'; end if;
  perform private.audit('approve_waitlist', null, jsonb_build_object('email', v_email));
end;
$$;

-- Settings the back office may change, each checked for sense.
create function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_key = 'max_users' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 100000 or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric) then
      raise exception 'max_users is a whole number from 1 to 100000' using errcode = '22023';
    end if;
  elsif p_key = 'signups_open' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'signups_open is true or false' using errcode = '22023'; end if;
  elsif p_key = 'min_app_version' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d+(\.\d+){0,2}$' then
      raise exception 'min_app_version looks like 1.2.3' using errcode = '22023';
    end if;
  elsif p_key = 'maintenance_message' then
    if jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') > 300 then
      raise exception 'The notice is text up to 300 characters' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown setting' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  perform private.audit('set_setting', null, jsonb_build_object('key', p_key, 'value', p_value));
end;
$$;

create function public.admin_set_limit(p_tier text, p_key text, p_value integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.plan_limits set value = p_value where tier = p_tier and limit_key = p_key;
  if not found then raise exception 'No such plan limit' using errcode = 'P0002'; end if;
  perform private.audit('set_limit', null, jsonb_build_object('tier', p_tier, 'key', p_key, 'value', p_value));
end;
$$;

create function public.admin_set_flag(p_key text, p_enabled boolean, p_early_access_only boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  insert into public.feature_flags (key, enabled, early_access_only) values (p_key, coalesce(p_enabled, false), coalesce(p_early_access_only, true))
  on conflict (key) do update set enabled = excluded.enabled, early_access_only = excluded.early_access_only;
  perform private.audit('set_flag', null, jsonb_build_object('key', p_key, 'enabled', p_enabled, 'early_access_only', p_early_access_only));
end;
$$;

-- Flags that are on for the signed-in person: everyone, or early-access people only.
create function public.my_flags()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(f.key order by f.key), '{}')
  from public.feature_flags f
  where f.enabled
    and (not f.early_access_only
         or coalesce((select early_access from public.profiles where user_id = (select auth.uid())), false));
$$;

create function public.admin_audit_log(p_limit integer default 100)
returns table (id bigint, created_at timestamptz, admin_email text, action text, target_email text, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select a.id, a.created_at, au.email::text, a.action, tu.email::text, a.detail
    from public.admin_audit a
    left join auth.users au on au.id = a.admin_id
    left join auth.users tu on tu.id = a.target_user
    order by a.id desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'am_i_admin()', 'admin_overview()', 'admin_list_users(text)', 'admin_set_tier(uuid, text)',
    'admin_set_early_access(uuid, boolean)', 'admin_list_waitlist()', 'admin_approve_waitlist(uuid)',
    'admin_set_setting(text, jsonb)', 'admin_set_limit(text, text, integer)',
    'admin_set_flag(text, boolean, boolean)', 'my_flags()', 'admin_audit_log(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

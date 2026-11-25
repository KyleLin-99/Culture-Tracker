-- Production readiness, part 1 (docs/design/production-launch.md): who is on which
-- plan, what each plan may create, a cap on total users with a waitlist, and
-- settings the back office will change. Lab roles (owner/tech/viewer) are separate
-- and unchanged. Limits only block NEW rows; nothing existing is touched.

-- ---------------------------------------------------------------------------
-- Profiles: one per person. tier is the plan; early_access opts into staging.
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  tier          text not null default 'standard' check (tier in ('standard', 'paid1', 'paid2', 'special')),
  early_access  boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;  -- changed only by back-office functions

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: functions only
revoke all on public.platform_admins from anon, authenticated;

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- A profile for every new user, and for everyone who already exists.
create function private.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger create_profile after insert on auth.users for each row execute function private.create_profile();
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Limits per plan. A null value means unlimited.
-- ---------------------------------------------------------------------------

create table public.plan_limits (
  tier       text not null check (tier in ('standard', 'paid1', 'paid2', 'special')),
  limit_key  text not null,
  value      integer check (value is null or value >= 0),
  primary key (tier, limit_key)
);
alter table public.plan_limits enable row level security;
create policy "anyone signed in reads limits" on public.plan_limits for select to authenticated using (true);
revoke all on public.plan_limits from anon, authenticated;
grant select on public.plan_limits to authenticated;

insert into public.plan_limits (tier, limit_key, value)
select t.tier, l.key, case t.tier when 'standard' then l.std when 'paid1' then l.p1 when 'paid2' then l.p2 else null end
from (values ('standard'), ('paid1'), ('paid2'), ('special')) as t (tier),
     (values
        ('labs_owned',        1,    2,     5),
        ('labs_joined',       3,    10,    25),
        ('members_per_lab',   5,    15,    50),
        ('strains',           25,   150,   1000),
        ('cultures',          2000, 20000, 100000),
        ('batches_and_runs',  200,  2000,  10000),
        ('recipes',           20,   100,   500),
        ('active_share_links', 3,   25,    100),
        ('pending_invites',   5,    25,    100)
     ) as l (key, std, p1, p2);

-- ---------------------------------------------------------------------------
-- App-wide settings (signups, the user cap, the minimum app version, a banner).
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key    text primary key,
  value  jsonb not null
);
alter table public.app_settings enable row level security;  -- read through signup_status()
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value) values
  ('max_users', '25'),
  ('signups_open', 'true'),
  ('min_app_version', '"0.0.0"'),
  ('maintenance_message', '""');

-- ---------------------------------------------------------------------------
-- Waitlist: people who asked for a place once the app was full.
-- ---------------------------------------------------------------------------

create table public.waitlist (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);
alter table public.waitlist enable row level security;  -- no policies: functions only
revoke all on public.waitlist from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The cap. A new sign-up is refused when signups are closed or the app is full,
-- unless the email was approved from the waitlist.
-- ---------------------------------------------------------------------------

create function private.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.app_settings where key = p_key;
$$;

create function private.is_full()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce((private.setting('signups_open'))::boolean, true)
      or (select count(*) from auth.users) >= coalesce((private.setting('max_users'))::int, 25);
$$;

create function private.enforce_user_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_full()
     and not exists (select 1 from public.waitlist where email = lower(new.email) and approved_at is not null) then
    raise exception 'signups_closed' using errcode = 'LM002';
  end if;
  return new;
end;
$$;
create trigger enforce_user_cap before insert on auth.users for each row execute function private.enforce_user_cap();

-- Callable signed out: the sign-in screen and the "please update" gate use it.
-- Reveals only counts-free facts: whether signups are open, the minimum version, a banner.
create function public.signup_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open', not private.is_full(),
    'min_app_version', coalesce(private.setting('min_app_version') #>> '{}', '0.0.0'),
    'message', coalesce(private.setting('maintenance_message') #>> '{}', '')
  );
$$;
revoke all on function public.signup_status() from public;
grant execute on function public.signup_status() to anon, authenticated;

create function public.join_waitlist(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.waitlist) >= 5000 then
    raise exception 'The waitlist is full right now. Please try again later.' using errcode = 'LM003';
  end if;
  insert into public.waitlist (email) values (lower(trim(p_email))) on conflict (email) do nothing;
exception when check_violation then
  raise exception 'Enter a valid email address.' using errcode = '22023';
end;
$$;
revoke all on function public.join_waitlist(text) from public;
grant execute on function public.join_waitlist(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Limits. The lab owner's plan sets what a lab may hold; a person's own plan sets
-- how many labs they own or join. Errors read "limit_reached:<key>:<value>".
-- ---------------------------------------------------------------------------

create function private.tier_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select tier from public.profiles where user_id = p_user), 'standard');
$$;

create function private.lab_tier(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.tier_of(user_id) from public.members
      where account_id = p_account_id and role = 'owner' order by created_at limit 1),
    'standard');
$$;

create function private.limit_value(p_tier text, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.plan_limits where tier = p_tier and limit_key = p_key;
$$;

-- Raises when `p_used` already meets the limit (null = unlimited).
create function private.check_limit(p_tier text, p_key text, p_used bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v integer := private.limit_value(p_tier, p_key);
begin
  if v is not null and p_used >= v then
    raise exception 'limit_reached:%:%', p_key, v using errcode = 'LM001';
  end if;
end;
$$;

-- before insert on a lab table: TG_ARGV[0] is the limit key.
create function private.enforce_lab_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k    text := tg_argv[0];
  acct uuid := new.account_id;
  tier text := private.lab_tier(new.account_id);
  used bigint;
begin
  if private.limit_value(tier, k) is null then
    return new;  -- unlimited: skip the count
  end if;
  used := case k
    when 'strains'            then (select count(*) from public.strains where account_id = acct)
    when 'cultures'           then (select count(*) from public.items where account_id = acct)
    when 'batches_and_runs'   then (select count(*) from public.media_batches where account_id = acct)
                                 + (select count(*) from public.sterilization_runs where account_id = acct)
    when 'recipes'            then (select count(*) from public.recipes where account_id = acct)
    when 'active_share_links' then (select count(*) from public.share_links where account_id = acct and revoked_at is null and expires_at > now())
    when 'pending_invites'    then (select count(*) from public.invites where account_id = acct and accepted_at is null and revoked_at is null and expires_at > now())
    when 'members_per_lab'    then (select count(*) from public.members where account_id = acct)
  end;
  perform private.check_limit(tier, k, used);
  return new;
end;
$$;

create trigger limit_strains  before insert on public.strains  for each row execute function private.enforce_lab_limit('strains');
create trigger limit_cultures before insert on public.items    for each row execute function private.enforce_lab_limit('cultures');
create trigger limit_batches  before insert on public.media_batches for each row execute function private.enforce_lab_limit('batches_and_runs');
create trigger limit_runs     before insert on public.sterilization_runs for each row execute function private.enforce_lab_limit('batches_and_runs');
create trigger limit_recipes  before insert on public.recipes  for each row execute function private.enforce_lab_limit('recipes');
create trigger limit_shares   before insert on public.share_links for each row execute function private.enforce_lab_limit('active_share_links');
create trigger limit_invites  before insert on public.invites  for each row execute function private.enforce_lab_limit('pending_invites');
create trigger limit_members  before insert on public.members  for each row execute function private.enforce_lab_limit('members_per_lab');

-- Labs owned / joined are per person, checked where labs are made and joined.
create or replace function public.create_account(p_name text, p_initials text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  perform private.check_limit(private.tier_of(v_user_id), 'labs_owned',
    (select count(*) from public.members where user_id = v_user_id and role = 'owner'));

  insert into public.accounts (name)
  values (trim(p_name))
  returning id into v_account_id;

  insert into public.members (account_id, user_id, role, initials)
  values (v_account_id, v_user_id, 'owner', upper(trim(p_initials)));

  return v_account_id;
end;
$$;

create or replace function public.accept_invite(p_code text, p_initials text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  inv    public.invites;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select * into inv from public.invites
  where code_hash = private.invite_hash(p_code)
    and accepted_at is null and revoked_at is null and expires_at > now()
  for update;
  if not found then
    raise exception 'That code isn''t valid. Codes work once and expire after 7 days; ask for a new one.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.members where account_id = inv.account_id and user_id = v_user) then
    raise exception 'You''re already in this lab' using errcode = 'P0001';
  end if;
  if inv.role = 'owner' then
    perform private.check_limit(private.tier_of(v_user), 'labs_owned',
      (select count(*) from public.members where user_id = v_user and role = 'owner'));
  else
    perform private.check_limit(private.tier_of(v_user), 'labs_joined',
      (select count(*) from public.members where user_id = v_user and role <> 'owner'));
  end if;
  insert into public.members (account_id, user_id, role, initials)
  values (inv.account_id, v_user, inv.role, upper(trim(p_initials)));
  update public.invites set accepted_by = v_user, accepted_at = now() where id = inv.id;
  return inv.account_id;
end;
$$;

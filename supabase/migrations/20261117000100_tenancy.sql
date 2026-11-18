-- Tenancy: accounts, members, and the membership check every RLS policy uses.
--
-- One account per lab. For now each user belongs to exactly one account, but
-- every table carries account_id so other growers can be added without a rewrite.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table public.members (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner', 'member')),
  -- Printed on every label next to the date and culture code.
  initials    text not null check (initials ~ '^[A-Z]{1,4}$'),
  created_at  timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index members_user_id_idx on public.members (user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the signed-in user belongs to the account. Security definer so the
-- lookup itself isn't filtered by the members policy; lives in a schema the API
-- doesn't expose.
create function private.is_member(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.account_id = p_account_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_member(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;

-- Keeps updated_at current; the offline sync in Milestone 2 pulls by it.
create function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

-- Called once after first sign-in: creates the lab account and makes the
-- caller its owner. Accounts aren't created by a signup trigger so that
-- invited growers (later) don't get an empty account of their own.
create function public.create_account(p_name text, p_initials text)
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

  if exists (select 1 from public.members where user_id = v_user_id) then
    raise exception 'You already belong to a lab account' using errcode = 'P0001';
  end if;

  insert into public.accounts (name)
  values (trim(p_name))
  returning id into v_account_id;

  insert into public.members (account_id, user_id, role, initials)
  values (v_account_id, v_user_id, 'owner', upper(trim(p_initials)));

  return v_account_id;
end;
$$;

revoke all on function public.create_account(text, text) from public, anon;
grant execute on function public.create_account(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.accounts enable row level security;
alter table public.members  enable row level security;

create policy "members read their account"
  on public.accounts for select to authenticated
  using (private.is_member(id));

create policy "members rename their account"
  on public.accounts for update to authenticated
  using (private.is_member(id))
  with check (private.is_member(id));

create policy "read memberships of my accounts"
  on public.members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(account_id));

-- Users may change their own initials and nothing else on their membership.
create policy "update my own membership"
  on public.members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Explicit grants, so access doesn't depend on the project's default privileges.
-- Signed-out (anon) users get nothing; RLS narrows what signed-in users see.
revoke all on public.accounts, public.members from anon, authenticated;
grant select, update (name) on public.accounts to authenticated;
grant select, update (initials) on public.members to authenticated;

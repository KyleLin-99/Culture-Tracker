-- Lab sharing, part 2 (docs/design/lab-sharing.md): invites by one-time code,
-- managing members, and belonging to more than one lab.

-- ---------------------------------------------------------------------------
-- More than one lab per person: create_account no longer refuses a second lab.
-- ---------------------------------------------------------------------------

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

  insert into public.accounts (name)
  values (trim(p_name))
  returning id into v_account_id;

  insert into public.members (account_id, user_id, role, initials)
  values (v_account_id, v_user_id, 'owner', upper(trim(p_initials)));

  return v_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invites: an owner makes a one-time code (ABCD-EFGH) for a role; whoever enters
-- it, signed in, joins the lab. Only a hash of the code is stored.
-- ---------------------------------------------------------------------------

create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  role         text not null check (role in ('owner', 'tech', 'viewer')),
  code_hash    text not null unique,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_by  uuid references auth.users (id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz
);

create index invites_account_idx on public.invites (account_id, created_at desc);

alter table public.invites enable row level security;
create policy "owners read invites" on public.invites for select to authenticated using (private.is_owner(account_id));
create policy "owners insert invites" on public.invites for insert to authenticated with check (private.is_owner(account_id));
create policy "owners revoke invites" on public.invites for update to authenticated
  using (private.is_owner(account_id)) with check (private.is_owner(account_id));
revoke all on public.invites from anon, authenticated;
grant select, insert, update (revoked_at) on public.invites to authenticated;

-- Codes leave out look-alikes (0/O, 1/I/L). Case, spaces and dashes are ignored.
create function private.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create function private.invite_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(private.normalize_invite_code(p_code), 'UTF8')), 'hex');
$$;

create function public.invite_member(p_account_id uuid, p_role text)
returns table (id uuid, code text, role text, expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw  bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  c    text := '';
  inv  public.invites;
begin
  if not private.is_owner(p_account_id) then
    raise exception 'Only the lab''s owners can invite people' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'tech', 'viewer') then
    raise exception 'Role is owner, tech or viewer' using errcode = '22023';
  end if;
  for i in 0..7 loop
    -- Bytes from the random parts of two v4 UUIDs.
    c := c || substr(alphabet, get_byte(raw, (array[0, 1, 2, 3, 4, 5, 16, 17])[i + 1]) % length(alphabet) + 1, 1);
  end loop;
  insert into public.invites (account_id, role, code_hash)
  values (p_account_id, p_role, private.invite_hash(c))
  returning * into inv;
  return query select inv.id, substr(c, 1, 4) || '-' || substr(c, 5, 4), inv.role, inv.expires_at;
end;
$$;

-- Security definer: the person accepting isn't a member yet, so RLS would hide the
-- invite. It finds only the invite whose code hash matches, and only while usable.
create function public.accept_invite(p_code text, p_initials text)
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
  insert into public.members (account_id, user_id, role, initials)
  values (inv.account_id, v_user, inv.role, upper(trim(p_initials)));
  update public.invites set accepted_by = v_user, accepted_at = now() where id = inv.id;
  return inv.account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members: owners change roles and remove people; anyone can leave. A lab always
-- keeps at least one owner.
-- ---------------------------------------------------------------------------

create function private.other_owners(p_account_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.members
  where account_id = p_account_id and role = 'owner' and user_id <> p_user_id;
$$;
revoke all on function private.other_owners(uuid, uuid) from public;

create function public.set_member_role(p_account_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur text;
begin
  if not private.is_owner(p_account_id) then
    raise exception 'Only the lab''s owners can change roles' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'tech', 'viewer') then
    raise exception 'Role is owner, tech or viewer' using errcode = '22023';
  end if;
  select role into cur from public.members where account_id = p_account_id and user_id = p_user_id;
  if not found then
    raise exception 'Not a member of this lab' using errcode = 'P0002';
  end if;
  if cur = 'owner' and p_role <> 'owner' and private.other_owners(p_account_id, p_user_id) = 0 then
    raise exception 'A lab needs at least one owner' using errcode = 'P0001';
  end if;
  update public.members set role = p_role where account_id = p_account_id and user_id = p_user_id;
end;
$$;

create function public.remove_member(p_account_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur text;
begin
  if not (private.is_owner(p_account_id) or p_user_id = auth.uid()) then
    raise exception 'Only the lab''s owners can remove people' using errcode = '42501';
  end if;
  select role into cur from public.members where account_id = p_account_id and user_id = p_user_id;
  if not found then
    raise exception 'Not a member of this lab' using errcode = 'P0002';
  end if;
  if cur = 'owner' and private.other_owners(p_account_id, p_user_id) = 0 then
    raise exception 'A lab needs at least one owner' using errcode = 'P0001';
  end if;
  -- Their records stay: rows keep created_by, labels keep their initials.
  delete from public.members where account_id = p_account_id and user_id = p_user_id;
end;
$$;

revoke all on function public.invite_member(uuid, text) from public, anon;
revoke all on function public.accept_invite(text, text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.invite_member(uuid, text) to authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

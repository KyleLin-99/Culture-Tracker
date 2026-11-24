-- Colonization checks: how far a culture has grown on a given day, as percent of
-- the plate covered and/or colony radius in mm. The app turns a culture's checks
-- into a growth rate and compares it with its ancestors' to spot senescence
-- (cultures losing vigor over repeated transfers).
--
-- Checks are written from phones (offline too), so both write paths are
-- idempotent functions keyed by the id the phone made. A check can be removed
-- (logged by mistake) but not edited: remove it and log it again.

create table public.colonization_checks (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  item_id     uuid not null,
  checked_on  date not null,
  percent     numeric check (percent is null or (percent >= 0 and percent <= 100)),
  radius_mm   numeric check (radius_mm is null or (radius_mm > 0 and radius_mm <= 500)),
  note        text,
  -- 'photo' is for estimates from photo analysis later (see the roadmap).
  source      text not null default 'manual' check (source in ('manual', 'photo')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check (percent is not null or radius_mm is not null),
  unique (account_id, id),
  foreign key (account_id, item_id) references public.items (account_id, id)
);

create index colonization_checks_item_idx on public.colonization_checks (item_id, checked_on);

create trigger colonization_checks_updated_at before update on public.colonization_checks
  for each row execute function private.set_updated_at();

-- Only removal changes a check.
create function private.protect_checks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'deleted_at' - 'updated_at') is distinct from (to_jsonb(old) - 'deleted_at' - 'updated_at') then
    raise exception 'A check can''t be changed; remove it and log it again' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger colonization_checks_protect before update on public.colonization_checks
  for each row execute function private.protect_checks();

alter table public.colonization_checks enable row level security;
create policy "members read"   on public.colonization_checks for select to authenticated using (private.is_member(account_id));
create policy "members insert" on public.colonization_checks for insert to authenticated with check (private.is_member(account_id));
create policy "members update" on public.colonization_checks for update to authenticated
  using (private.is_member(account_id)) with check (private.is_member(account_id));
revoke all on public.colonization_checks from anon, authenticated;
grant select, insert, update on public.colonization_checks to authenticated;

-- ---------------------------------------------------------------------------
-- Writing: log a check (safe to resend), remove one (safe to resend)
-- ---------------------------------------------------------------------------

create function public.apply_check(
  p_id         uuid,
  p_item_id    uuid,
  p_checked_on date,
  p_percent    numeric default null,
  p_radius_mm  numeric default null,
  p_note       text default null
)
returns public.colonization_checks
language plpgsql
set search_path = ''
as $$
declare
  v    public.colonization_checks;
  item public.items;
begin
  select * into v from public.colonization_checks where id = p_id;
  if found then
    return v;
  end if;

  select * into item from public.items where id = p_item_id and deleted_at is null;
  if not found then
    raise exception 'Culture not found' using errcode = 'P0002';
  end if;
  if p_percent is null and p_radius_mm is null then
    raise exception 'A check needs a percent colonized or a radius' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on < item.made_on then
    raise exception 'A check can''t be dated before the culture was made' using errcode = '22023';
  end if;

  insert into public.colonization_checks (id, account_id, item_id, checked_on, percent, radius_mm, note)
  values (p_id, item.account_id, item.id, p_checked_on, p_percent, p_radius_mm, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v;
  return v;
end;
$$;

create function public.remove_check(p_id uuid)
returns public.colonization_checks
language plpgsql
set search_path = ''
as $$
declare
  v public.colonization_checks;
begin
  update public.colonization_checks set deleted_at = coalesce(deleted_at, now()) where id = p_id
  returning * into v;
  if v.id is null then
    raise exception 'Check not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

revoke all on function public.apply_check(uuid, uuid, date, numeric, numeric, text) from public, anon;
revoke all on function public.remove_check(uuid) from public, anon;
grant execute on function public.apply_check(uuid, uuid, date, numeric, numeric, text) to authenticated;
grant execute on function public.remove_check(uuid) to authenticated;

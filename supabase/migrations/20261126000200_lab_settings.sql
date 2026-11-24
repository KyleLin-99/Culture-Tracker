-- Lab settings: one row per lab. First setting: how often each kind of backup
-- needs refreshing (slants, LC, agar and other stored cultures lose viability with
-- age). The app lists active backups older than their refresh age on the home
-- screen. Missing media fall back to the app's defaults (src/domain/backups.ts).

create table public.lab_settings (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id) on delete cascade,
  -- {"slant": 180, "lc": 120, "agar": 60, "other": 180}: days between refreshes
  backup_refresh_days  jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (account_id),
  unique (account_id, id)
);

create trigger lab_settings_updated_at before update on public.lab_settings
  for each row execute function private.set_updated_at();

alter table public.lab_settings enable row level security;
create policy "members read"   on public.lab_settings for select to authenticated using (private.is_member(account_id));
create policy "members insert" on public.lab_settings for insert to authenticated with check (private.is_member(account_id));
create policy "members update" on public.lab_settings for update to authenticated
  using (private.is_member(account_id)) with check (private.is_member(account_id));
revoke all on public.lab_settings from anon, authenticated;
grant select, insert, update on public.lab_settings to authenticated;

-- Sets refresh ages (whole days, 1–3650) for any of slant, lc, agar, other.
-- Media left out keep their current value.
create function public.set_backup_refresh(p_account_id uuid, p_days jsonb)
returns public.lab_settings
language plpgsql
set search_path = ''
as $$
declare
  k text;
  val jsonb;
  v public.lab_settings;
begin
  if not private.is_member(p_account_id) then
    raise exception 'Not a member of this lab' using errcode = '42501';
  end if;
  if jsonb_typeof(p_days) is distinct from 'object' then
    raise exception 'Refresh ages must be an object of days by medium' using errcode = '22023';
  end if;
  for k, val in select * from jsonb_each(p_days) loop
    if k not in ('slant', 'lc', 'agar', 'other') then
      raise exception 'Unknown backup medium: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(val) is distinct from 'number' or (val::text)::numeric <> floor((val::text)::numeric)
       or (val::text)::numeric < 1 or (val::text)::numeric > 3650 then
      raise exception 'Refresh age for % must be whole days from 1 to 3650', k using errcode = '22023';
    end if;
  end loop;

  insert into public.lab_settings (account_id, backup_refresh_days)
  values (p_account_id, p_days)
  on conflict (account_id) do update
    set backup_refresh_days = public.lab_settings.backup_refresh_days || excluded.backup_refresh_days
  returning * into v;
  return v;
end;
$$;

revoke all on function public.set_backup_refresh(uuid, jsonb) from public, anon;
grant execute on function public.set_backup_refresh(uuid, jsonb) to authenticated;

-- Roles in a lab (docs/design/lab-sharing.md):
--   owner  - everything, including lab settings, members and renaming the lab
--   tech   - records: strains, cultures, notes, checks, runs, batches, recipes
--   viewer - reads everything, changes nothing (except their own initials)
-- Reading stays on private.is_member(); writing moves to private.can_write() or,
-- for lab-wide settings, private.is_owner(). Functions are security invoker, so
-- these policies govern them too. Existing 'member' rows become 'tech' (until now
-- nothing checked the role, and labs had only owners).

update public.members set role = 'tech' where role = 'member';
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner', 'tech', 'viewer'));

-- Same shape as is_member(): security definer so the lookup isn't filtered by the
-- members policy; in the private schema the API doesn't expose.
create function private.can_write(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.account_id = p_account_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'tech')
  );
$$;

create function private.is_owner(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.account_id = p_account_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

revoke all on function private.can_write(uuid), private.is_owner(uuid) from public;
grant execute on function private.can_write(uuid), private.is_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Write policies
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['strains', 'sterilization_runs', 'media_batches', 'items', 'events',
                           'relabels', 'recipes', 'colonization_checks'] loop
    execute format('drop policy "members insert" on public.%I', t);
    execute format('drop policy "members update" on public.%I', t);
    execute format(
      'create policy "writers insert" on public.%I for insert to authenticated with check (private.can_write(account_id))', t);
    execute format(
      'create policy "writers update" on public.%I for update to authenticated using (private.can_write(account_id)) with check (private.can_write(account_id))', t);
  end loop;
end;
$$;

drop policy "members insert" on public.lab_settings;
drop policy "members update" on public.lab_settings;
create policy "owners insert" on public.lab_settings for insert to authenticated with check (private.is_owner(account_id));
create policy "owners update" on public.lab_settings for update to authenticated
  using (private.is_owner(account_id)) with check (private.is_owner(account_id));

drop policy "members rename their account" on public.accounts;
create policy "owners rename their account" on public.accounts for update to authenticated
  using (private.is_owner(id)) with check (private.is_owner(id));

-- ---------------------------------------------------------------------------
-- Functions that check membership themselves: clearer errors for viewers and techs
-- (identical otherwise)
-- ---------------------------------------------------------------------------

create or replace function public.save_recipe(
  p_account_id  uuid,
  p_family_id   uuid,
  p_name        text,
  p_kind        text,
  p_volume_ml   numeric,
  p_ingredients jsonb,
  p_steps       text default null
)
returns public.recipes
language plpgsql
set search_path = ''
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_version integer := 1;
  v_family  uuid := p_family_id;
  v_ing     jsonb := '[]'::jsonb;
  e         jsonb;
  v         public.recipes;
begin
  if not private.is_member(p_account_id) then
    raise exception 'Not a member of this lab' using errcode = '42501';
  end if;
  if not private.can_write(p_account_id) then
    raise exception 'Viewers can''t change this lab' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'A recipe needs a name' using errcode = '22023';
  end if;
  if jsonb_typeof(p_ingredients) is distinct from 'array' or jsonb_array_length(p_ingredients) = 0 then
    raise exception 'A recipe needs at least one ingredient' using errcode = '22023';
  end if;

  -- Ingredients: a name, an amount of zero or more, and a unit. Stored cleaned up.
  for e in select * from jsonb_array_elements(p_ingredients) loop
    if coalesce(btrim(e ->> 'name'), '') = '' or coalesce(btrim(e ->> 'unit'), '') = ''
       or jsonb_typeof(e -> 'amount') is distinct from 'number' or (e ->> 'amount')::numeric < 0 then
      raise exception 'Each ingredient needs a name, an amount and a unit' using errcode = '22023';
    end if;
    v_ing := v_ing || jsonb_build_array(jsonb_build_object(
      'name', btrim(e ->> 'name'), 'amount', (e ->> 'amount')::numeric, 'unit', btrim(e ->> 'unit')));
  end loop;

  if v_family is null then
    v_family := gen_random_uuid();
  else
    select max(version) + 1 into v_version
    from public.recipes where family_id = v_family and account_id = p_account_id;
    if v_version is null then
      raise exception 'Recipe not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.recipes where family_id = v_family and deleted_at is not null) then
      raise exception 'This recipe is archived' using errcode = 'P0001';
    end if;
  end if;

  -- Names are unique among the lab's recipes in use (other families).
  if exists (
    select 1 from public.recipes r
    where r.account_id = p_account_id and r.family_id <> v_family and r.deleted_at is null
      and lower(r.name) = lower(v_name)
      and r.version = (select max(x.version) from public.recipes x where x.family_id = r.family_id)
  ) then
    raise exception 'There''s already a recipe called %', v_name using errcode = '23505';
  end if;

  insert into public.recipes (account_id, family_id, version, name, kind, volume_ml, ingredients, steps)
  values (p_account_id, v_family, v_version, v_name, p_kind, p_volume_ml, v_ing, nullif(btrim(coalesce(p_steps, '')), ''))
  returning * into v;
  return v;
end;
$$;

create or replace function public.set_backup_refresh(p_account_id uuid, p_days jsonb)
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
  if not private.is_owner(p_account_id) then
    raise exception 'Only the lab''s owners can change lab settings' using errcode = '42501';
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

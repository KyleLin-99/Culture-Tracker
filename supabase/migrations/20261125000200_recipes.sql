-- Recipes: saved, versioned agar and liquid-culture recipes. Media batches can
-- record the exact recipe version and volume they were made from, and the
-- contamination trace compares recipes like it compares batches and runs.
--
-- Versions: editing a recipe saves a new row (version + 1) in the same family,
-- so a batch always points at what was actually mixed. A saved version never
-- changes; archiving hides the whole family from pickers but keeps it for history.

create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  family_id    uuid not null,
  version      integer not null check (version >= 1),
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  kind         text not null check (kind in ('agar', 'lc', 'other')),
  volume_ml    numeric not null check (volume_ml > 0),
  -- [{ "name": "Malt extract", "amount": 20, "unit": "g" }, ...]
  ingredients  jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredients) = 'array'),
  steps        text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (account_id, id),
  unique (account_id, family_id, version)
);

create index recipes_family_idx on public.recipes (family_id, version desc);

create trigger recipes_updated_at before update on public.recipes
  for each row execute function private.set_updated_at();

-- A saved version is a record of what was mixed: only archiving may change it.
create function private.protect_recipes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'deleted_at' - 'updated_at') is distinct from (to_jsonb(old) - 'deleted_at' - 'updated_at') then
    raise exception 'A saved recipe version can''t be changed; save a new version instead' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger recipes_protect before update on public.recipes
  for each row execute function private.protect_recipes();

alter table public.recipes enable row level security;
create policy "members read"   on public.recipes for select to authenticated using (private.is_member(account_id));
create policy "members insert" on public.recipes for insert to authenticated with check (private.is_member(account_id));
create policy "members update" on public.recipes for update to authenticated
  using (private.is_member(account_id)) with check (private.is_member(account_id));
revoke all on public.recipes from anon, authenticated;
grant select, insert, update on public.recipes to authenticated;

-- Batches: which recipe version, and how much was made.
alter table public.media_batches
  add column recipe_id uuid,
  add column volume_ml numeric check (volume_ml is null or volume_ml > 0),
  add foreign key (account_id, recipe_id) references public.recipes (account_id, id);

-- ---------------------------------------------------------------------------
-- Saving: a new recipe (p_family_id null) or a new version of one.
-- ---------------------------------------------------------------------------

create function public.save_recipe(
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

-- Archive: hides every version from pickers. Batches keep pointing at them.
create function public.archive_recipe(p_family_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.recipes set deleted_at = now() where family_id = p_family_id and deleted_at is null;
  if not found and not exists (select 1 from public.recipes where family_id = p_family_id) then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.save_recipe(uuid, uuid, text, text, numeric, jsonb, text) from public, anon;
revoke all on function public.archive_recipe(uuid) from public, anon;
grant execute on function public.save_recipe(uuid, uuid, text, text, numeric, jsonb, text) to authenticated;
grant execute on function public.archive_recipe(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Contamination trace: recipes become a cause too, grouped by recipe family
-- (all versions) and labelled with the recipe's current name.
-- ---------------------------------------------------------------------------

create or replace function public.contamination_trace(
  p_from      date default current_date - 60,
  p_to        date default current_date,
  p_strain_id uuid default null
)
returns table (
  factor             text,     -- 'parent' | 'media_batch' | 'sterilization_run' | 'recipe' | 'made_on'
  factor_id          text,
  label              text,
  contaminated_with  integer,  -- a
  clean_with         integer,  -- c
  contaminated_total integer,  -- a + b
  clean_total        integer,  -- c + d
  rate_with          numeric,
  rate_without       numeric,
  relative_risk      numeric,
  p_value            double precision
)
language sql
stable
set search_path = ''
as $$
  with cohort as (
    select i.*,
           (i.status = 'contaminated'
            or exists (select 1 from public.events e
                       where e.item_id = i.id and e.type = 'contaminated' and e.deleted_at is null)) as contaminated
    from public.items i
    where i.kind in ('transfer', 'backup')
      and i.deleted_at is null
      and i.made_on between p_from and p_to
      and (p_strain_id is null or i.strain_id = p_strain_id)
  ),
  scored as (
    select * from cohort where contaminated or status <> 'discarded'
  ),
  totals as (
    select count(*) filter (where contaminated)::int as n_contam,
           count(*) filter (where not contaminated)::int as n_clean
    from scored
  ),
  facts as (
    select s.contaminated, 'parent' as factor, s.parent_id::text as factor_id, p.code as label
    from scored s join public.items p on p.id = s.parent_id
    union all
    select s.contaminated, 'media_batch', s.media_batch_id::text, m.code
    from scored s join public.media_batches m on m.id = s.media_batch_id
    union all
    select s.contaminated, 'sterilization_run', r.id::text, r.code
    from scored s
    join public.media_batches m on m.id = s.media_batch_id
    join public.sterilization_runs r on r.id = m.sterilization_run_id
    union all
    select s.contaminated, 'recipe', rc.family_id::text,
           (select x.name from public.recipes x where x.family_id = rc.family_id order by x.version desc limit 1)
    from scored s
    join public.media_batches m on m.id = s.media_batch_id
    join public.recipes rc on rc.id = m.recipe_id
    union all
    select s.contaminated, 'made_on', s.made_on::text, to_char(s.made_on, 'YYYY-MM-DD')
    from scored s
  ),
  cells as (
    select f.factor, f.factor_id, f.label,
           count(*) filter (where f.contaminated)::int as a,
           count(*) filter (where not f.contaminated)::int as c,
           t.n_contam, t.n_clean
    from facts f cross join totals t
    group by f.factor, f.factor_id, f.label, t.n_contam, t.n_clean
  ),
  stats as (
    select cells.*,
           n_contam - a as b,
           n_clean - c as d,
           case when a = 0 or c = 0 or n_contam - a = 0 or n_clean - c = 0 then 0.5 else 0 end as h
    from cells
    where a > 0
      and (n_contam - a) + (n_clean - c) > 0
  )
  select factor, factor_id, label, a, c, n_contam, n_clean,
         round(a::numeric / (a + c), 3),
         case when b + d = 0 then null else round(b::numeric / (b + d), 3) end,
         round(((a + h) / (a + c + 2 * h)) / ((b + h) / (b + d + 2 * h)), 2),
         private.fisher_greater(a, b, c, d)
  from stats
  order by 11, 10 desc, a desc, label;
$$;

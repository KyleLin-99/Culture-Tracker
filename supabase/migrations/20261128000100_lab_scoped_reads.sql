-- Lists follow the lab you're working in.
--
-- Since someone can belong to several labs (20261127000300_invites.sql), row-level
-- security lets them read all of those labs at once. The app now asks for one lab
-- explicitly; these three functions gain p_account_id for that. Null keeps the old
-- answer (every lab you belong to), which the Claude tools (mcp-server) still use.
-- Security is unchanged: these stay security invoker, so RLS still applies.

drop function public.lookup_code(text);
drop function public.stats_rows(date, date);
drop function public.contamination_trace(date, date, uuid);

create function public.lookup_code(p_query text, p_account_id uuid default null)
returns table (
  id          uuid,
  code        text,
  strain_id   uuid,
  strain_name text,
  kind        text,
  medium      text,
  status      text,
  made_on     date,
  initials    text,
  exact       boolean
)
language sql
stable
set search_path = ''
as $$
  with q as (
    select upper(regexp_replace(coalesce(p_query, ''), '\s', '', 'g')) as v
  )
  select i.id, i.code, i.strain_id, s.name, i.kind, i.medium, i.status, i.made_on, i.initials,
         (i.code = q.v or q.v = any (i.aliases)) as exact
  from public.items i
  join public.strains s on s.id = i.strain_id
  cross join q
  where q.v <> ''
    and i.deleted_at is null
    and (p_account_id is null or i.account_id = p_account_id)
    and (i.code = q.v or q.v = any (i.aliases) or i.code like replace(replace(q.v, '%', '\%'), '_', '\_') || '%')
  order by exact desc, s.name, char_length(i.code), i.code
  limit 25;
$$;

create function public.stats_rows(p_from date, p_to date, p_account_id uuid default null)
returns table (
  id            uuid,
  strain_id     uuid,
  strain_name   text,
  kind          text,
  medium        text,
  generation    integer,
  made_on       date,
  status        text,
  contaminated  boolean,
  batch_id      uuid,
  batch_code    text,
  run_id        uuid,
  run_code      text,
  recipe_family uuid,
  recipe_name   text
)
language sql
stable
set search_path = ''
as $$
  select i.id, i.strain_id, s.name, i.kind, i.medium, i.generation, i.made_on, i.status,
         (i.status = 'contaminated'
          or exists (select 1 from public.events e
                     where e.item_id = i.id and e.type = 'contaminated' and e.deleted_at is null)) as contaminated,
         m.id, m.code, r.id, r.code, rc.family_id,
         (select x.name from public.recipes x where x.family_id = rc.family_id order by x.version desc limit 1)
  from public.items i
  join public.strains s on s.id = i.strain_id
  left join public.media_batches m on m.id = i.media_batch_id
  left join public.sterilization_runs r on r.id = m.sterilization_run_id
  left join public.recipes rc on rc.id = m.recipe_id
  where i.kind in ('transfer', 'backup')
    and i.deleted_at is null
    and (p_account_id is null or i.account_id = p_account_id)
    and i.made_on between p_from and p_to
    and (i.status <> 'discarded'
         or i.status = 'contaminated'
         or exists (select 1 from public.events e
                    where e.item_id = i.id and e.type = 'contaminated' and e.deleted_at is null))
  order by i.made_on, i.id;
$$;

create function public.contamination_trace(
  p_from      date default current_date - 60,
  p_to        date default current_date,
  p_strain_id uuid default null,
  p_account_id uuid default null
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
      and (p_account_id is null or i.account_id = p_account_id)
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

revoke all on function public.lookup_code(text, uuid) from public, anon;
revoke all on function public.stats_rows(date, date, uuid) from public, anon;
revoke all on function public.contamination_trace(date, date, uuid, uuid) from public, anon;
grant execute on function public.lookup_code(text, uuid) to authenticated;
grant execute on function public.stats_rows(date, date, uuid) to authenticated;
grant execute on function public.contamination_trace(date, date, uuid, uuid) to authenticated;

-- Contamination trace: which shared causes (parent culture, media batch,
-- sterilization run, day made) are over-represented among contaminated
-- cultures, compared with the clean ones made in the same window.
--
-- For each cause, a 2x2 table:
--                     has the cause   doesn't
--   contaminated            a            b
--   clean                   c            d
-- relative risk = (a / (a + c)) / (b / (b + d))   (0.5 added to every cell if any is 0)
-- p value       = one-sided Fisher's exact test: the chance of seeing a or more
--                 contaminated cultures with this cause if the cause made no difference.

-- ln(n!) for small n (lab-sized counts).
create function private.ln_factorial(p_n integer)
returns double precision
language sql
immutable
strict
as $$
  select coalesce(sum(ln(i::double precision)), 0) from generate_series(2, p_n) as i;
$$;

-- One-sided Fisher's exact test, P(X >= a).
create function private.fisher_greater(a integer, b integer, c integer, d integer)
returns double precision
language plpgsql
immutable
strict
as $$
declare
  n1    integer := a + b;          -- contaminated
  k     integer := a + c;          -- has the cause
  n     integer := a + b + c + d;  -- everyone
  base  double precision;
  total double precision := 0;
begin
  if n = 0 or k = 0 or n1 = 0 then
    return 1;
  end if;
  base := private.ln_factorial(n1) + private.ln_factorial(n - n1)
        + private.ln_factorial(k) + private.ln_factorial(n - k) - private.ln_factorial(n);
  for x in a .. least(n1, k) loop
    if k - x <= n - n1 then
      total := total + exp(base - private.ln_factorial(x) - private.ln_factorial(n1 - x)
                       - private.ln_factorial(k - x) - private.ln_factorial(n - n1 - k + x));
    end if;
  end loop;
  return least(1, total);
end;
$$;

grant execute on function private.ln_factorial(integer) to authenticated;
grant execute on function private.fisher_greater(integer, integer, integer, integer) to authenticated;

create function public.contamination_trace(
  p_from      date default current_date - 60,
  p_to        date default current_date,
  p_strain_id uuid default null
)
returns table (
  factor             text,     -- 'parent' | 'media_batch' | 'sterilization_run' | 'made_on'
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
    -- Cultures made in the window. Contaminated = marked contaminated now or
    -- ever (an event), so a contaminated plate that was later discarded still counts.
    -- Discarded without a contamination record: reason unknown, left out.
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
      -- A cause every compared culture shares (e.g. one parent for the whole
      -- window) can't explain why some contaminated and others didn't.
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

revoke all on function public.contamination_trace(date, date, uuid) from public, anon;
grant execute on function public.contamination_trace(date, date, uuid) to authenticated;

-- Stats: one row per transfer or backup made in a date range, with what it was
-- made from (batch, run, recipe) and whether it contaminated. The app groups these
-- into contamination rates (by recipe, run, batch, generation, month) and growth by
-- strain. Phones build the same rows from their local copy (src/offline/queries.ts).
--
-- "Contaminated" and "scored" follow contamination_trace(): marked contaminated
-- now or at any point (a contaminated event), and clean plates that were
-- discarded aren't counted, since they say nothing either way.

create function public.stats_rows(p_from date, p_to date)
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
    and i.made_on between p_from and p_to
    and (i.status <> 'discarded'
         or i.status = 'contaminated'
         or exists (select 1 from public.events e
                    where e.item_id = i.id and e.type = 'contaminated' and e.deleted_at is null))
  order by i.made_on, i.id;
$$;

revoke all on function public.stats_rows(date, date) from public, anon;
grant execute on function public.stats_rows(date, date) to authenticated;

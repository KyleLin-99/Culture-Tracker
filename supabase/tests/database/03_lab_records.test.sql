-- Sterilization runs, media batches and the contamination trace.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'kyle@example.com');

create schema tests;
grant usage on schema tests to authenticated;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function tests.item(p_code text) returns uuid language sql as $$
  select id from public.items where code = p_code;
$$;
create function tests.run(p_code text) returns uuid language sql as $$
  select id from public.sterilization_runs where code = p_code;
$$;
create function tests.batch(p_code text) returns uuid language sql as $$
  select id from public.media_batches where code = p_code;
$$;
create function tests.acct() returns uuid language sql as $$
  select account_id from public.members limit 1;
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab', 'KL'); end $$;

-- ---------------------------------------------------------------------------
-- Codes
-- ---------------------------------------------------------------------------

insert into public.sterilization_runs (account_id, method, psi, minutes) values (tests.acct(), 'pressure_cooker', 15, 90);
insert into public.sterilization_runs (account_id, method, psi, minutes) values (tests.acct(), 'pressure_cooker', 15, 45);
select is((select array_agg(code order by code) from public.sterilization_runs), array['SR-001', 'SR-002'],
  'sterilization runs get SR-001, SR-002 automatically');

insert into public.sterilization_runs (account_id, code, method) values (tests.acct(), ' pc-7 ', 'autoclave');
select ok(tests.run('PC-7') is not null, 'a typed code is kept, trimmed and upper-cased');

insert into public.media_batches (account_id, kind, recipe, sterilization_run_id) values (tests.acct(), 'agar', 'MEA 2%', tests.run('SR-001'));
insert into public.media_batches (account_id, kind, recipe, sterilization_run_id) values (tests.acct(), 'agar', 'MEA 2%', tests.run('SR-002'));
select is((select array_agg(code order by code) from public.media_batches), array['MB-001', 'MB-002'],
  'media batches get MB-001, MB-002 automatically');

select throws_ok(
  $$ insert into public.media_batches (account_id, code, kind) values (tests.acct(), 'MB-001', 'lc') $$,
  '23505', null, 'codes are unique within a lab');

-- ---------------------------------------------------------------------------
-- Transfers onto a batch
-- ---------------------------------------------------------------------------

insert into public.strains (id, account_id, name) values ('10000000-0000-0000-0000-000000000001', tests.acct(), 'Blue Oyster');
insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
values (tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S');
do $$ begin perform public.create_transfers(tests.item('S'), 1, 'agar'); end $$;
-- S-1 itself is the shared parent; take it out of the comparison.
do $$ begin perform public.set_item_status(tests.item('S-1'), 'discarded'); end $$;

-- 12 plates on MB-001 (run SR-001), then 5 on MB-002 (run SR-002), all from S-1 today.
do $$ begin perform public.create_transfers(tests.item('S-1'), 12, 'agar', current_date, tests.batch('MB-001')); end $$;
do $$ begin perform public.create_transfers(tests.item('S-1'), 5, 'agar', current_date, tests.batch('MB-002')); end $$;
select is((select count(*)::int from public.items where media_batch_id = tests.batch('MB-002')), 5,
  'create_transfers records the media batch');

-- 4 of the 5 MB-002 plates and 1 of the 12 MB-001 plates contaminate.
do $$ begin
  perform public.set_item_status(tests.item(c), 'contaminated', null, 'trich')
  from unnest(array['S-1M', 'S-1N', 'S-1O', 'S-1P', 'S-1A']) as c;
end $$;

-- ---------------------------------------------------------------------------
-- Trace
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(factor order by p_value, relative_risk desc, contaminated_with desc, label)
   from (select * from public.contamination_trace() limit 2) t),
  array['media_batch', 'sterilization_run'],
  'the bad media batch and its sterilization run rank first');

select is(
  (select row(contaminated_with, clean_with, contaminated_total, clean_total)::text
   from public.contamination_trace() where label = 'SR-002'),
  '(4,1,5,12)', 'SR-002: 4 contaminated and 1 clean plate used it, out of 5 contaminated and 12 clean');
select is((select relative_risk from public.contamination_trace() where label = 'SR-002'), 9.60,
  'relative risk = (4/5) / (1/12) = 9.6');
select is((select round(p_value::numeric, 5) from public.contamination_trace() where label = 'SR-002'), 0.00986,
  'Fisher one-sided p = 61/6188 = 0.00986');
select is((select round(p_value::numeric, 3) from public.contamination_trace() where label = 'SR-001'), 1.000,
  'the good run is not flagged');
select is((select count(*)::int from public.contamination_trace() where factor in ('parent', 'made_on')), 0,
  'causes every plate shares (one parent, one day) are left out: they can''t explain a difference');

select is(round(private.fisher_greater(3, 0, 0, 3)::numeric, 6), 0.05, 'Fisher p for a perfect 3 vs 3 split is 1/20');

-- A clean plate discarded for no recorded reason leaves the comparison;
-- a contaminated plate that was later discarded still counts as contaminated.
do $$ begin
  perform public.set_item_status(tests.item('S-1B'), 'discarded');
  perform public.set_item_status(tests.item('S-1M'), 'discarded');
end $$;
select is((select row(contaminated_total, clean_total)::text from public.contamination_trace() where label = 'SR-002'),
  '(5,11)', 'discarded-clean plates drop out; discarded-contaminated plates still count');

select is((select count(*)::int from public.contamination_trace(current_date + 1, current_date + 30)), 0,
  'the date window limits which plates are compared');
select is((select count(*)::int from public.contamination_trace(p_strain_id => gen_random_uuid())), 0,
  'the strain filter limits which plates are compared');

-- Plates from a second day: now the day made can be compared.
do $$ begin perform public.create_transfers(tests.item('S-1'), 3, 'agar', current_date - 1); end $$;
select is((select contaminated_with from public.contamination_trace() where factor = 'made_on'), 5,
  'day made becomes a factor once plates come from different days');

select lives_ok($$ select * from public.contamination_trace() $$, 'trace runs as a signed-in member');

select * from finish();
rollback;

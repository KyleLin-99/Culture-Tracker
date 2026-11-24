-- stats_rows(): the plates stats count, what they were made from, and which contaminated.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

create schema tests;
grant usage on schema tests to authenticated;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function tests.acct() returns uuid language sql as $$
  select account_id from public.members where user_id = auth.uid();
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'KL'); end $$;
insert into public.strains (id, account_id, name) values ('10000000-0000-0000-0000-000000000001', tests.acct(), 'Blue Oyster');
insert into public.items (id, account_id, strain_id, kind, medium, origin_prefix, made_on)
values ('20000000-0000-0000-0000-000000000001', tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S', '2026-10-01');
insert into public.sterilization_runs (id, account_id, method) values ('30000000-0000-0000-0000-000000000001', tests.acct(), 'pressure_cooker');
create temp table mea as select * from public.save_recipe(tests.acct(), null, 'MEA', 'agar', 500, '[{"name": "Agar", "amount": 10, "unit": "g"}]');
create temp table mea2 as select * from public.save_recipe(tests.acct(), (select family_id from mea), 'MEA 2%', 'agar', 500, '[{"name": "Agar", "amount": 10, "unit": "g"}]');
insert into public.media_batches (id, account_id, kind, sterilization_run_id, recipe_id)
values ('40000000-0000-0000-0000-000000000001', tests.acct(), 'agar', '30000000-0000-0000-0000-000000000001', (select id from mea));

-- Four plates on the batch, made 2026-11-01: one contaminated, one contaminated
-- then retired, one clean and discarded (not counted), one clean.
do $$
declare ids uuid[];
begin
  select array_agg(id order by position) into ids
  from public.create_transfers('20000000-0000-0000-0000-000000000001', 4, 'agar', '2026-11-01', '40000000-0000-0000-0000-000000000001');
  perform public.set_item_status(ids[1], 'contaminated');
  perform public.set_item_status(ids[2], 'contaminated');
  perform public.set_item_status(ids[2], 'discarded');
  perform public.set_item_status(ids[3], 'discarded');
end $$;
-- One more plate outside the range.
do $$ begin perform public.create_transfers('20000000-0000-0000-0000-000000000001', 1, 'agar', '2026-09-01'); end $$;

create temp table rows as select * from public.stats_rows('2026-10-15', '2026-11-30');
select is((select count(*)::int from rows), 3, 'transfers in range, without the clean discarded plate or the origin');
select is((select count(*)::int from rows where contaminated), 2,
  'contaminated now, or contaminated then retired');
select is((select distinct row(strain_name, generation, batch_code is not null, run_code is not null)::text from rows),
  '("Blue Oyster",1,t,t)', 'each row carries its strain, generation, batch and run');
select is((select distinct recipe_name from rows), 'MEA 2%', 'recipes are named by their current version');
select is((select distinct recipe_family from rows), (select family_id from mea), '... and grouped by recipe family');
select is((select count(*)::int from public.stats_rows('2026-08-01', '2026-11-30')), 4, 'the range is inclusive and moves');

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.stats_rows('2000-01-01', '2100-01-01')), 0, 'another lab gets nothing');

select * from finish();
rollback;

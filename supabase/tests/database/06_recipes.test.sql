-- Recipes: versioned, fixed once saved, picked by batches, compared by the trace.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

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
create function tests.mea() returns jsonb language sql as $$
  select '[{"name": " Malt extract ", "amount": 10, "unit": "g"}, {"name": "Agar", "amount": 10, "unit": "g"}]'::jsonb;
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'KL'); end $$;

-- ---------------------------------------------------------------------------
-- Saving and versions
-- ---------------------------------------------------------------------------

create temp table v1 as select * from public.save_recipe(tests.acct(), null, ' MEA 2% ', 'agar', 500, tests.mea(), 'Stir, cook 45 min');
select is((select row(name, version, volume_ml)::text from v1), '("MEA 2%",1,500)', 'a new recipe is version 1, name trimmed');
select is((select ingredients -> 0 ->> 'name' from v1), 'Malt extract', 'ingredient names are trimmed');
select is((select family_id from v1) is not null, true, 'it starts a recipe family');

create temp table v2 as select * from public.save_recipe(tests.acct(), (select family_id from v1), 'MEA 2%', 'agar', 1000,
  '[{"name": "Malt extract", "amount": 20, "unit": "g"}, {"name": "Agar", "amount": 20, "unit": "g"}, {"name": "Nutritional yeast", "amount": 2, "unit": "g"}]');
select is((select version from v2), 2, 'saving again makes version 2 of the same family');
select is((select count(*)::int from public.recipes where family_id = (select family_id from v1)), 2, '... and keeps version 1');

select throws_ok($$ update public.recipes set volume_ml = 750 where id = (select id from v1) $$,
  'P0001', 'A saved recipe version can''t be changed; save a new version instead', 'a saved version can''t be edited in place');

select throws_ok($$ select public.save_recipe(tests.acct(), null, 'mea 2%', 'agar', 500, tests.mea()) $$,
  '23505', 'There''s already a recipe called mea 2%', 'two recipes can''t share a name (any case)');
select throws_ok($$ select public.save_recipe(tests.acct(), null, '  ', 'agar', 500, tests.mea()) $$,
  '22023', 'A recipe needs a name', 'a name is required');
select throws_ok($$ select public.save_recipe(tests.acct(), null, 'Empty', 'agar', 500, '[]') $$,
  '22023', 'A recipe needs at least one ingredient', 'at least one ingredient');
select throws_ok($$ select public.save_recipe(tests.acct(), null, 'Bad', 'agar', 500, '[{"name": "Agar", "amount": -1, "unit": "g"}]') $$,
  '22023', 'Each ingredient needs a name, an amount and a unit', 'amounts can''t be negative');
select throws_ok($$ select public.save_recipe(tests.acct(), null, 'Bad', 'agar', 0, tests.mea()) $$,
  '23514', null, 'volume must be more than zero');

-- ---------------------------------------------------------------------------
-- Batches record the recipe version and volume
-- ---------------------------------------------------------------------------

insert into public.media_batches (account_id, kind, recipe_id, volume_ml) values (tests.acct(), 'agar', (select id from v1), 500);
select is((select r.version from public.media_batches m join public.recipes r on r.id = m.recipe_id), 1,
  'a batch points at the exact version it was made from');

-- ---------------------------------------------------------------------------
-- Archiving
-- ---------------------------------------------------------------------------

do $$ begin perform public.archive_recipe((select family_id from v1)); end $$;
select is((select count(*)::int from public.recipes where family_id = (select family_id from v1) and deleted_at is null), 0,
  'archiving hides every version');
select is((select count(*)::int from public.media_batches where recipe_id = (select id from v1)), 1, 'batches keep their recipe');
select throws_ok($$ select public.save_recipe(tests.acct(), (select family_id from v1), 'MEA 2%', 'agar', 500, tests.mea()) $$,
  'P0001', 'This recipe is archived', 'an archived recipe gets no new versions');
select lives_ok($$ select public.save_recipe(tests.acct(), null, 'MEA 2%', 'agar', 500, tests.mea()) $$,
  'an archived recipe''s name can be used again');

-- ---------------------------------------------------------------------------
-- Contamination trace compares recipes
-- ---------------------------------------------------------------------------

insert into public.strains (id, account_id, name) values ('10000000-0000-0000-0000-000000000001', tests.acct(), 'Blue Oyster');
insert into public.items (id, account_id, strain_id, kind, medium, origin_prefix)
values ('20000000-0000-0000-0000-000000000001', tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S');
create temp table lc as select * from public.save_recipe(tests.acct(), null, 'Honey LC', 'lc', 1000,
  '[{"name": "Honey", "amount": 40, "unit": "g"}]');
insert into public.media_batches (id, account_id, kind, recipe_id) values
  ('40000000-0000-0000-0000-000000000001', tests.acct(), 'agar', (select id from v2)),
  ('40000000-0000-0000-0000-000000000002', tests.acct(), 'lc', (select id from lc));
-- 3 plates on the MEA batch (2 contaminate), 3 on the honey batch (all clean).
do $$
declare r record;
begin
  perform public.create_transfers('20000000-0000-0000-0000-000000000001', 3, 'agar', current_date, '40000000-0000-0000-0000-000000000001');
  perform public.create_transfers('20000000-0000-0000-0000-000000000001', 3, 'lc', current_date, '40000000-0000-0000-0000-000000000002');
  for r in select id from public.items where media_batch_id = '40000000-0000-0000-0000-000000000001' order by position limit 2 loop
    perform public.set_item_status(r.id, 'contaminated');
  end loop;
end $$;
select is((select row(contaminated_with, clean_with)::text from public.contamination_trace() where factor = 'recipe'),
  '(2,1)', 'the trace counts plates by the recipe their batch used');
select is((select label from public.contamination_trace() where factor = 'recipe'), 'MEA 2%',
  'labelled with the recipe''s name');

-- ---------------------------------------------------------------------------
-- Other labs and signed-out users
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.recipes), 0, 'another lab sees none of these recipes');
select throws_ok($$ select public.save_recipe((select account_id from v1), null, 'Sneaky', 'agar', 500, tests.mea()) $$,
  '42501', 'Not a member of this lab', 'and can''t save recipes into this lab');

select * from finish();
rollback;

-- Roles: owners do everything, techs record work, viewers only read.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'tech@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');

create schema tests;
grant usage on schema tests to authenticated;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function tests.lab() returns uuid language sql as $$ select id from public.accounts limit 1 $$;
create function tests.id(p_code text) returns uuid language sql as $$ select id from public.items where code = p_code $$;
grant execute on all functions in schema tests to authenticated;

-- The owner sets up a lab with a culture and a note.
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'KL'); end $$;
insert into public.strains (id, account_id, name) values ('10000000-0000-0000-0000-000000000001', tests.lab(), 'Blue Oyster');
insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
values (tests.lab(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S');
do $$ begin perform public.create_transfers(tests.id('S'), 1, 'agar'); end $$;

-- A tech and a viewer join (invites come in the next PR).
reset role;
insert into public.members (account_id, user_id, role, initials) values
  (tests.lab(), '00000000-0000-0000-0000-00000000000b', 'tech', 'TE'),
  (tests.lab(), '00000000-0000-0000-0000-00000000000c', 'viewer', 'VI');
select throws_ok(
  $$ insert into public.members (account_id, user_id, role, initials)
     values (tests.lab(), '00000000-0000-0000-0000-00000000000c', 'member', 'XX') $$,
  '23514', null, 'roles are owner, tech or viewer');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Tech: records work, not lab settings
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.items), 2, 'a tech sees the lab');
select lives_ok($$ select public.create_transfers(tests.id('S-1'), 1, 'agar') $$, 'a tech can transfer');
select lives_ok($$ select public.set_item_status(tests.id('S-1A'), 'contaminated') $$, 'a tech can mark status');
select lives_ok($$ insert into public.strains (account_id, name) values (tests.lab(), 'King') $$, 'a tech can add strains');
select lives_ok($$ select public.apply_check(gen_random_uuid(), tests.id('S-1'), current_date, 20) $$, 'a tech can log growth checks');
select lives_ok($$ select public.save_recipe(tests.lab(), null, 'MEA', 'agar', 500, '[{"name": "Agar", "amount": 10, "unit": "g"}]') $$,
  'a tech can save recipes');
select throws_ok($$ select public.set_backup_refresh(tests.lab(), '{"lc": 30}') $$,
  '42501', 'Only the lab''s owners can change lab settings', 'a tech can''t change lab settings');
update public.accounts set name = 'Renamed by tech' where id = tests.lab();
select is((select name from public.accounts where id = tests.lab()), 'Lab A', 'a tech can''t rename the lab');

-- ---------------------------------------------------------------------------
-- Viewer: reads everything, changes nothing
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.items), 3, 'a viewer sees every culture');
select is((select count(*)::int from public.item_lineage(tests.id('S-1'), 'both')), 3, 'a viewer can read lineage');
select is((select count(*)::int from public.recipes), 1, '... and recipes');
select throws_ok($$ select public.create_transfers(tests.id('S-1'), 1, 'agar') $$,
  '42501', null, 'a viewer can''t transfer');
select throws_ok($$ insert into public.strains (account_id, name) values (tests.lab(), 'Lions Mane') $$,
  '42501', null, 'a viewer can''t add strains');
select throws_ok($$ select public.apply_check(gen_random_uuid(), tests.id('S-1'), current_date, 20) $$,
  '42501', null, 'a viewer can''t log growth checks');
select throws_ok($$ select public.save_recipe(tests.lab(), null, 'PDA', 'agar', 500, '[{"name": "Agar", "amount": 10, "unit": "g"}]') $$,
  '42501', 'Viewers can''t change this lab', 'a viewer can''t save recipes');
select throws_ok($$ select public.set_item_status(tests.id('S-1'), 'discarded') $$,
  'P0002', null, 'a viewer''s status change finds nothing it may change');
update public.items set location = 'fridge' where id = tests.id('S-1');
reset role;
select is((select location from public.items where id = tests.id('S-1')), null, '... and direct updates change nothing');
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
update public.members set initials = 'VW' where user_id = '00000000-0000-0000-0000-00000000000c';
select is((select initials from public.members where user_id = '00000000-0000-0000-0000-00000000000c'), 'VW',
  'a viewer can still change their own initials');

-- ---------------------------------------------------------------------------
-- Owner: everything
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.set_backup_refresh(tests.lab(), '{"lc": 30}') $$, 'the owner changes lab settings');
update public.accounts set name = 'Lab A (renamed)' where id = tests.lab();
select is((select name from public.accounts where id = tests.lab()), 'Lab A (renamed)', 'the owner renames the lab');
select lives_ok($$ select public.create_transfers(tests.id('S-1'), 1, 'agar') $$, 'the owner records work too');

select * from finish();
rollback;

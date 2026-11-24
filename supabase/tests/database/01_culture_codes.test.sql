-- Culture code rules, lineage functions and item history.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- Fixtures: one user, signed in, with a lab account and two strains
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'kyle@example.com');

create schema tests;
grant usage on schema tests to authenticated;

create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function tests.id(p_code text, p_strain text default 'Blue Oyster') returns uuid language sql as $$
  select i.id from public.items i join public.strains s on s.id = i.strain_id
  where i.code = p_code and s.name = p_strain;
$$;
create function tests.codes(p_rows uuid[]) returns text[] language sql as $$
  select array_agg(i.code order by i.created_at, i.position) from public.items i where i.id = any (p_rows);
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');

select isnt(public.create_account('Kyle''s Lab', 'kl'), null, 'create_account returns the new account id');
select is((select initials from public.members), 'KL', 'initials are stored upper-case');
-- (Belonging to several labs is covered in 12_invites.test.sql.)
select is((select role from public.members), 'owner', 'the creator owns the new lab');

insert into public.strains (id, account_id, name, species)
select '10000000-0000-0000-0000-000000000001', account_id, 'Blue Oyster', 'Pleurotus ostreatus' from public.members;
insert into public.strains (id, account_id, name, species)
select '10000000-0000-0000-0000-000000000002', account_id, 'Lion''s Mane', 'Hericium erinaceus' from public.members;

-- ---------------------------------------------------------------------------
-- Origins
-- ---------------------------------------------------------------------------

insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
select account_id, '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 's' from public.members;
select is((select code from public.items where kind = 'origin' and origin_prefix = 'S'), 'S',
  'first spore print has no number');

insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
select account_id, '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S' from public.members;
select ok(tests.id('S2') is not null, 'second spore print in the strain becomes S2');

insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
select account_id, '10000000-0000-0000-0000-000000000001', 'origin', 'tissue', 'W' from public.members;
insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
select account_id, '10000000-0000-0000-0000-000000000001', 'origin', 'culture', 'TBG' from public.members;
select ok(tests.id('W') is not null and tests.id('TBG') is not null, 'wild clone and vendor origins');

insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
select account_id, '10000000-0000-0000-0000-000000000002', 'origin', 'spore_print', 'S' from public.members;
select ok(tests.id('S', 'Lion''s Mane') is not null, 'origin numbering is per strain: another strain starts at S');

select is((select initials from public.items where id = tests.id('S')), 'KL', 'initials default to the member''s');
select is((select generation from public.items where id = tests.id('S')), 0, 'origins are generation 0');

-- ---------------------------------------------------------------------------
-- Transfers: numbers and letters alternate
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S'), 3, 'agar')),
  array['S-1', 'S-2', 'S-3'], 'first plates off an origin get numbers');

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S-2'), 2, 'agar')),
  array['S-2A', 'S-2B'], 'transfers off a numbered plate get letters');

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S-2A'), 1, 'lc')),
  array['S-2A1'], 'transfers off a lettered plate get numbers');

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S-2A1'), 2, 'agar')),
  array['S-2A1A', 'S-2A1B'], 'and back to letters');

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S-2'), 1, 'agar')),
  array['S-2C'], 'later transfers continue the sibling sequence');

select is((select generation from public.items where id = tests.id('S-2A1')), 3, 'generation counts transfers');
select is((select strain_id from public.items where id = tests.id('S-2A1')),
  '10000000-0000-0000-0000-000000000001'::uuid, 'strain is inherited from the parent');

select is(private.position_letters(1),  'A',  '1 -> A');
select is(private.position_letters(26), 'Z',  '26 -> Z');
select is(private.position_letters(27), 'AA', '27 -> AA');
select is(private.position_letters(53), 'BA', '53 -> BA');

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('TBG'), 1, 'agar')),
  array['TBG-1'], 'vendor origin');

-- ---------------------------------------------------------------------------
-- Backups and revivals
-- ---------------------------------------------------------------------------

select is((public.create_backup(tests.id('S-2A1'))).code, 'S-2A1(1)', 'first backup is (1)');
select is((public.create_backup(tests.id('S-2A1'), 'lc')).code, 'S-2A1(2)', 'second backup is (2)');
select is((select generation from public.items where id = tests.id('S-2A1(2)')), 3,
  'a backup keeps its parent''s generation');

select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S-2A1(2)'), 2, 'agar')),
  array['S-2A1(2)-1', 'S-2A1(2)-2'], 'plates revived from a backup start a new dash segment');
select is(
  (select array_agg(code order by position) from public.create_transfers(tests.id('S-2A1(2)-1'), 1, 'agar')),
  array['S-2A1(2)-1A'], 'and alternate as usual');
select is((select generation from public.items where id = tests.id('S-2A1(2)-1A')), 5, 'revival generations continue');

select is(
  (select array_agg(code order by backup_number) from public.create_backups(tests.id('S-3'), 3, 'slant')),
  array['S-3(1)', 'S-3(2)', 'S-3(3)'], 'create_backups makes several numbered backups at once');
select is(
  (select array_agg(code order by backup_number) from public.create_backups(tests.id('S-3'), 2, 'lc')),
  array['S-3(4)', 'S-3(5)'], 'a later batch continues the numbering');
select is(
  (select note from public.events where item_id = tests.id('S-3') and type = 'backed_up' and note like '3 ×%'),
  '3 × slant backup: S-3(1) … S-3(3)', 'create_backups logs one event on the parent');

-- ---------------------------------------------------------------------------
-- 20-character limit
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid := tests.id('TBG-1');
begin
  -- TBG-1 is 5 characters; each transfer adds one. Stop at exactly 20.
  for i in 1 .. 15 loop
    select id into v_id from public.create_transfers(v_id, 1, 'agar');
  end loop;
end;
$$;

select is((select char_length(code) from public.items where id = tests.id('TBG-1A1A1A1A1A1A1A1A')), 20,
  'a 20-character code is allowed');
select throws_ok(
  $$ select public.create_transfers(tests.id('TBG-1A1A1A1A1A1A1A1A'), 1, 'agar') $$,
  '23514', 'Culture code TBG-1A1A1A1A1A1A1A1A1 would be 21 characters; the limit is 20',
  'a 21-character code is rejected');
select throws_ok(
  $$ select public.create_backup(tests.id('TBG-1A1A1A1A1A1A1A1A')) $$,
  '23514', null, 'a backup that would pass 20 characters is rejected');

-- ---------------------------------------------------------------------------
-- Lineage is fixed once written
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.items set code = 'S-9' where id = tests.id('S-2') $$,
  '23514', null, 'codes can''t be edited');
select throws_ok(
  $$ update public.items set parent_id = tests.id('S-1') where id = tests.id('S-2A') $$,
  '23514', null, 'parents can''t be changed');
select lives_ok(
  $$ update public.items set location = 'Shelf 2', notes = 'fast' where id = tests.id('S-2') $$,
  'location and notes can be edited');

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

select is(
  (select note from public.events where item_id = tests.id('S-2') and type = 'transferred' order by occurred_at, created_at limit 1),
  '2 × agar: S-2A … S-2B', 'create_transfers logs an event on the parent');

select is((public.set_item_status(tests.id('S-2B'), 'contaminated', null, 'trich')).status, 'contaminated',
  'set_item_status changes the status');
select is((select contam_type from public.events where item_id = tests.id('S-2B') and type = 'contaminated'), 'trich',
  'and logs a contamination event');

-- ---------------------------------------------------------------------------
-- Lookup, lineage and tree
-- ---------------------------------------------------------------------------

select is((select code from public.lookup_code(' s-2a1 (2) ') where exact), 'S-2A1(2)',
  'lookup ignores spaces and case');
select is((select count(*)::int from public.lookup_code('S-2A1')), 8,
  'lookup also returns codes that start with the query');

select is(
  (select array_agg(code order by depth) from public.item_lineage(tests.id('S-2A1'), 'up')),
  array['S', 'S-2', 'S-2A', 'S-2A1'], 'item_lineage walks up to the origin');
select is(
  (select count(*)::int from public.item_lineage(tests.id('S-2A1'), 'down') where depth > 0),
  7, 'item_lineage walks down through transfers, backups and revivals');

select is(
  (select array_agg(code) from public.item_lineage(tests.id('S-2'), 'both')),
  array['S', 'S-2', 'S-2A', 'S-2A1', 'S-2A1A', 'S-2A1B', 'S-2A1(1)', 'S-2A1(2)',
        'S-2A1(2)-1', 'S-2A1(2)-1A', 'S-2A1(2)-2', 'S-2B', 'S-2C'],
  'item_lineage lists ancestors first, then each child directly under its parent');

-- S2 gets 10 plates so ordering by number (not text) is visible: S2-9 before S2-10.
do $$ begin perform public.create_transfers(tests.id('S2'), 10, 'agar'); end $$;
select is(
  (select array_agg(code) from public.strain_tree('10000000-0000-0000-0000-000000000001')
   where code like 'S2-%'),
  array['S2-1', 'S2-2', 'S2-3', 'S2-4', 'S2-5', 'S2-6', 'S2-7', 'S2-8', 'S2-9', 'S2-10'],
  'strain_tree orders siblings numerically');
select is(
  (select array_agg(code) from public.strain_tree('10000000-0000-0000-0000-000000000001')
   where code like 'S-2%' and depth <= 3),
  array['S-2', 'S-2A', 'S-2A1', 'S-2B', 'S-2C'], 'strain_tree lists children under their parent');

select * from finish();
rollback;

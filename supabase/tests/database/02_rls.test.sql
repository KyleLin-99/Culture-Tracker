-- Row-level security: one lab can never see or change another lab's data.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on all functions in schema tests to authenticated;

-- Lab A: an account, a strain, an origin and a plate.
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'AA'); end $$;
insert into public.strains (id, account_id, name)
select '20000000-0000-0000-0000-00000000000a', account_id, 'A strain' from public.members;
insert into public.items (id, account_id, strain_id, kind, medium, origin_prefix)
select '30000000-0000-0000-0000-00000000000a', account_id, '20000000-0000-0000-0000-00000000000a',
       'origin', 'spore_print', 'S' from public.members;
do $$ begin perform public.create_transfers('30000000-0000-0000-0000-00000000000a', 1, 'agar'); end $$;

-- Lab B signs in.
select tests.sign_in('00000000-0000-0000-0000-00000000000b');
do $$ begin perform public.create_account('Lab B', 'BB'); end $$;

select is((select count(*)::int from public.accounts), 1, 'B sees only its own account');
select is((select count(*)::int from public.members), 1, 'B sees only its own membership');
select is((select count(*)::int from public.strains), 0, 'B can''t see A''s strains');
select is((select count(*)::int from public.items), 0, 'B can''t see A''s items');
select is((select count(*)::int from public.events), 0, 'B can''t see A''s events');
select is((select count(*)::int from public.lookup_code('S')), 0, 'lookup_code doesn''t leak A''s codes');
select is((select count(*)::int from public.item_lineage('30000000-0000-0000-0000-00000000000a')), 0,
  'item_lineage doesn''t leak A''s lineage');

select throws_ok(
  $$ insert into public.strains (account_id, name)
     values ((select id from public.accounts where name = 'Lab A'), 'Sneaky') $$,
  null, null, 'B can''t insert into A''s account (A''s id isn''t even visible)');

-- Even knowing A's ids, B can't write into A's account.
select throws_ok(
  $$ insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
     values ((select account_id from public.members where user_id = '00000000-0000-0000-0000-00000000000a'),
             '20000000-0000-0000-0000-00000000000a', 'origin', 'spore_print', 'S') $$,
  null, null, 'B can''t insert an item into A''s account');

select throws_ok(
  $$ select public.create_transfers('30000000-0000-0000-0000-00000000000a', 1, 'agar') $$,
  'P0002', 'Item not found', 'B can''t create transfers from A''s items');

-- B's own strain can't point at A's item as a parent.
insert into public.strains (id, account_id, name)
select '20000000-0000-0000-0000-00000000000b', account_id, 'B strain' from public.members;
select throws_ok(
  $$ insert into public.items (account_id, strain_id, parent_id, kind, medium)
     select account_id, '20000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000a',
            'transfer', 'agar' from public.members $$,
  '23503', null, 'B can''t parent an item on A''s culture');

update public.items set status = 'discarded' where id = '30000000-0000-0000-0000-00000000000a';

select throws_ok(
  $$ delete from public.strains where id = '20000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'rows can''t be hard-deleted');

select throws_ok(
  $$ update public.members set role = 'member' $$,
  '42501', null, 'members can''t change their own role');

-- Back to A: the update attempt by B changed nothing.
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select is((select status from public.items where id = '30000000-0000-0000-0000-00000000000a'), 'active',
  'B''s update of A''s item had no effect');

-- Signed out: no access at all.
set local role anon;
select throws_ok($$ select count(*) from public.items $$, '42501', null, 'signed-out users can''t read anything');

select * from finish();
rollback;

-- Notes can be edited and removed; the rest of an item's history can't.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

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
insert into public.items (id, account_id, strain_id, kind, medium, origin_prefix)
values ('20000000-0000-0000-0000-000000000001', tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S');
do $$ begin perform public.create_transfers('20000000-0000-0000-0000-000000000001', 1, 'agar'); end $$;
insert into public.events (id, account_id, item_id, type, note)
values ('30000000-0000-0000-0000-000000000001', tests.acct(), '20000000-0000-0000-0000-000000000001', 'note', 'Slow growth');

-- ---------------------------------------------------------------------------
-- Editing
-- ---------------------------------------------------------------------------

select is((public.edit_note('30000000-0000-0000-0000-000000000001', '  Fast, rhizomorphic  ')).note,
  'Fast, rhizomorphic', 'a note can be edited (and is trimmed)');
select is((public.edit_note('30000000-0000-0000-0000-000000000001', 'Fast, rhizomorphic')).note,
  'Fast, rhizomorphic', 'sending the same edit again is harmless');
select throws_ok($$ select public.edit_note('30000000-0000-0000-0000-000000000001', '   ') $$,
  '22023', 'A note can''t be empty', 'an empty note is refused');

-- ---------------------------------------------------------------------------
-- Other history is fixed
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.edit_note((select id from public.events where type = 'transferred'), 'changed') $$,
  'P0001', 'Only notes can be edited or removed', 'edit_note refuses a transfer entry');
select throws_ok(
  $$ update public.events set note = 'changed' where type = 'transferred' $$,
  'P0001', 'Only notes can be edited or removed', 'a direct update can''t change a transfer entry');
select throws_ok(
  $$ update public.events set deleted_at = now() where type = 'transferred' $$,
  'P0001', 'Only notes can be edited or removed', '... or remove it');
select throws_ok(
  $$ update public.events set type = 'checked' where id = '30000000-0000-0000-0000-000000000001' $$,
  'P0001', 'History entries can''t be moved, retyped or redated', 'a note can''t be turned into another kind of entry');
select throws_ok(
  $$ update public.events set occurred_at = now() - interval '1 day' where id = '30000000-0000-0000-0000-000000000001' $$,
  'P0001', 'History entries can''t be moved, retyped or redated', '... or redated');

-- ---------------------------------------------------------------------------
-- Removing
-- ---------------------------------------------------------------------------

select isnt((public.edit_note('30000000-0000-0000-0000-000000000001', p_delete => true)).deleted_at,
  null, 'a note can be removed');
create temp table first_delete as
  select deleted_at from public.events where id = '30000000-0000-0000-0000-000000000001';
select is((public.edit_note('30000000-0000-0000-0000-000000000001', p_delete => true)).deleted_at,
  (select deleted_at from first_delete), 'removing it again keeps the first removal time');
select throws_ok($$ select public.edit_note('30000000-0000-0000-0000-000000000001', 'too late') $$,
  'P0001', 'This note was removed', 'a removed note can''t be edited');

-- ---------------------------------------------------------------------------
-- Other labs and signed-out users
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.edit_note('30000000-0000-0000-0000-000000000001', 'mine now') $$,
  'P0002', 'Note not found', 'another lab can''t see or edit the note');

reset role;
select ok(not has_function_privilege('anon', 'public.edit_note(uuid, text, boolean)', 'execute'),
  'signed-out users can''t call edit_note');

select * from finish();
rollback;

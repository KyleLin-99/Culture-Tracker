-- Technique changes (Stats markers): title and note limits, owners and techs add
-- them in their own lab only, nobody outside the lab sees them, anon has no
-- access, and they're removed with deleted_at, never deleted.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'owner-c@example.com');

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated;
create function tests.id(p_key text) returns uuid language sql as $$
  select val::uuid from tests.v where k = p_key;
$$;
grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.technique_changes'::regclass), 'row-level security is on');
select table_privs_are('public', 'technique_changes', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'signed-in people can read, add and update, but not delete');
select table_privs_are('public', 'technique_changes', 'anon', array[]::text[], 'anon has no access');
select col_not_null('public', 'technique_changes', 'account_id', 'every change belongs to a lab');

-- ---------------------------------------------------------------------------
-- Lab A adds changes
-- ---------------------------------------------------------------------------

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v values ('lab_a', public.create_account('Lab A', 'KL')::text);

with t as (
  insert into public.technique_changes (account_id, changed_on, title, note)
  values (tests.id('lab_a'), '2026-11-01', 'Started using a flow hood', 'Laminar flow, 2x2 ft')
  returning id
)
insert into tests.v select 'hood', id::text from t;
select is((select created_by from public.technique_changes where id = tests.id('hood')),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'created_by is the person who added it');

-- Title: 1 to 80 characters once trimmed.
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', '') $$,
  '23514', null, 'an empty title is refused');
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', '   ') $$,
  '23514', null, 'a title of only spaces is refused');
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', repeat('x', 81)) $$,
  '23514', null, 'an 81-character title is refused');
select lives_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', repeat('x', 80)) $$,
  'an 80-character title is fine');
select lives_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', ' ' || repeat('y', 80) || ' ') $$,
  'surrounding spaces don''t count toward the 80');
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', null) $$,
  '23502', null, 'a title is required');
select throws_ok($$ insert into public.technique_changes (account_id, title) values (tests.id('lab_a'), 'No date') $$,
  '23502', null, 'a date is required');

-- Note: up to 500 characters.
select lives_ok($$ insert into public.technique_changes (account_id, changed_on, title, note) values (tests.id('lab_a'), '2026-11-01', 'Long note', repeat('n', 500)) $$,
  'a 500-character note is fine');
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title, note) values (tests.id('lab_a'), '2026-11-01', 'Too long', repeat('n', 501)) $$,
  '23514', null, 'a 501-character note is refused');

-- Removed with deleted_at, never deleted.
select throws_ok($$ delete from public.technique_changes where id = tests.id('hood') $$,
  '42501', null, 'nobody can delete a technique change, not even the owner');
update public.technique_changes set deleted_at = now() where title = 'Long note';
select ok((select deleted_at is not null from public.technique_changes where title = 'Long note'), 'the owner removes one by setting deleted_at');

-- ---------------------------------------------------------------------------
-- Lab C: another account sees and changes none of Lab A's
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000c');
insert into tests.v values ('lab_c', public.create_account('Lab C', 'OT')::text);
insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_c'), '2026-10-01', 'Lab C change');

select is((select array_agg(title) from public.technique_changes), array['Lab C change'], 'another lab sees only its own changes');
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', 'Sneaky') $$,
  '42501', null, 'another lab can''t add a change to Lab A');
update public.technique_changes set title = 'Hijacked', deleted_at = now() where id = tests.id('hood');
select throws_ok($$ update public.technique_changes set account_id = tests.id('lab_a') where title = 'Lab C change' $$,
  '42501', null, 'another lab can''t move its change into Lab A');

reset role;
select is((select title from public.technique_changes where id = tests.id('hood')), 'Started using a flow hood',
  'another lab''s update leaves Lab A''s change alone');
select is((select deleted_at from public.technique_changes where id = tests.id('hood')), null, '... and doesn''t remove it');

-- Lab A still sees its own, and not Lab C's.
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.technique_changes where account_id = tests.id('lab_c')), 0, 'Lab A doesn''t see Lab C''s change');
select is((select count(*)::int from public.technique_changes where deleted_at is null), 3, 'Lab A sees its live changes (the removed one is kept, marked deleted)');

-- ---------------------------------------------------------------------------
-- Anon: nothing
-- ---------------------------------------------------------------------------

set local role anon;
select throws_ok($$ select count(*) from public.technique_changes $$, '42501', null, 'anon can''t read technique changes');
select throws_ok($$ insert into public.technique_changes (account_id, changed_on, title) values (tests.id('lab_a'), '2026-11-01', 'Anon') $$,
  '42501', null, 'anon can''t add technique changes');

select * from finish();
rollback;

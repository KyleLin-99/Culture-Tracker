-- Colonization checks: logged once (safe to resend), removable, never edited, lab-only.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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
values ('20000000-0000-0000-0000-000000000001', tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'agar', 'S', '2026-11-01');

-- ---------------------------------------------------------------------------
-- Logging
-- ---------------------------------------------------------------------------

select is(
  (select row(percent, radius_mm, note, source)::text
   from public.apply_check('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-11-05', 25, 12, '  ok  ')),
  '(25,12,ok,manual)', 'a check stores percent, radius and a trimmed note');
select is(
  (select percent from public.apply_check('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-11-06', 99)),
  25::numeric, 'resending the same check (same id) changes nothing');
select is((select count(*)::int from public.colonization_checks), 1, '... and adds no second row');
select lives_ok(
  $$ select public.apply_check('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2026-11-08', null, 30) $$,
  'radius alone is enough');

select throws_ok(
  $$ select public.apply_check(gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '2026-11-08') $$,
  '22023', 'A check needs a percent colonized or a radius', 'a check needs a measurement');
select throws_ok(
  $$ select public.apply_check(gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '2026-10-30', 10) $$,
  '22023', 'A check can''t be dated before the culture was made', 'a check can''t predate the culture');
select throws_ok(
  $$ select public.apply_check(gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '2026-11-08', 120) $$,
  '23514', null, 'percent stays within 0–100');
select throws_ok(
  $$ select public.apply_check(gen_random_uuid(), gen_random_uuid(), '2026-11-08', 10) $$,
  'P0002', 'Culture not found', 'the culture must exist');

-- ---------------------------------------------------------------------------
-- Fixed once logged; removable
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.colonization_checks set percent = 50 where id = '30000000-0000-0000-0000-000000000001' $$,
  'P0001', 'A check can''t be changed; remove it and log it again', 'a check can''t be edited');
select isnt((public.remove_check('30000000-0000-0000-0000-000000000001')).deleted_at, null, 'a check can be removed');
create temp table first_remove as select deleted_at from public.colonization_checks where id = '30000000-0000-0000-0000-000000000001';
select is((public.remove_check('30000000-0000-0000-0000-000000000001')).deleted_at, (select deleted_at from first_remove),
  'removing it again keeps the first removal time');

-- ---------------------------------------------------------------------------
-- Other labs and signed-out users
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.colonization_checks), 0, 'another lab sees no checks');
select throws_ok(
  $$ select public.apply_check(gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '2026-11-08', 10) $$,
  'P0002', 'Culture not found', 'and can''t log checks on this lab''s cultures');

reset role;
select ok(not has_function_privilege('anon', 'public.apply_check(uuid, uuid, date, numeric, numeric, text)', 'execute'),
  'signed-out users can''t log checks');

select * from finish();
rollback;

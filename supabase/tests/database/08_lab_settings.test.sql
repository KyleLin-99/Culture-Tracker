-- Lab settings: backup refresh ages, validated, merged, lab-only.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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

select is((public.set_backup_refresh(tests.acct(), '{"slant": 200, "lc": 90}')).backup_refresh_days,
  '{"lc": 90, "slant": 200}'::jsonb, 'the first save creates the lab''s settings');
select is((public.set_backup_refresh(tests.acct(), '{"lc": 100, "agar": 45}')).backup_refresh_days,
  '{"lc": 100, "agar": 45, "slant": 200}'::jsonb, 'later saves merge: media left out keep their value');
select is((select count(*)::int from public.lab_settings), 1, 'one settings row per lab');

select throws_ok($$ select public.set_backup_refresh(tests.acct(), '{"tissue": 30}') $$,
  '22023', 'Unknown backup medium: tissue', 'only backup media');
select throws_ok($$ select public.set_backup_refresh(tests.acct(), '{"lc": 0}') $$,
  '22023', 'Refresh age for lc must be whole days from 1 to 3650', 'at least one day');
select throws_ok($$ select public.set_backup_refresh(tests.acct(), '{"lc": 12.5}') $$,
  '22023', 'Refresh age for lc must be whole days from 1 to 3650', 'whole days');
select throws_ok($$ select public.set_backup_refresh(tests.acct(), '[90]') $$,
  '22023', 'Refresh ages must be an object of days by medium', 'an object by medium');

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.lab_settings), 0, 'another lab sees no settings');
select throws_ok($$ select public.set_backup_refresh((select account_id from public.members limit 1), '{"lc": 1}') $$,
  '42501', 'Not a member of this lab', 'and can''t change them');

select * from finish();
rollback;

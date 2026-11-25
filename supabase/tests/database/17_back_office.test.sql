-- Back office: only platform admins can use the admin functions, every change is
-- audited, nobody else can see or change plans, and flags follow early access.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'person@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000a');
insert into public.waitlist (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'wait@example.com');

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on all functions in schema tests to authenticated, anon;

set local role authenticated;

-- A regular person --------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is(public.am_i_admin(), false, 'a regular person is not an admin');
select throws_ok($$ select public.admin_overview() $$, '42501', 'Only the app''s administrators can do this', 'overview is admin only');
select throws_ok($$ select * from public.admin_list_users('') $$, '42501', null, 'the user list is admin only');
select throws_ok($$ select public.admin_set_tier('00000000-0000-0000-0000-00000000000b', 'special') $$, '42501', null, 'nobody upgrades themselves');
select throws_ok($$ select public.admin_set_setting('max_users', '1000') $$, '42501', null, 'settings are admin only');
select throws_ok($$ select public.admin_approve_waitlist('00000000-0000-0000-0000-0000000000f1') $$, '42501', null, 'the waitlist is admin only');
select throws_ok($$ select * from public.admin_audit_log() $$, '42501', null, 'the audit log is admin only');
select throws_ok($$ select * from public.admin_audit $$, '42501', null, 'the audit table is not readable');
select is(public.my_flags(), '{}'::text[], 'no flags are on to begin with');

-- An admin ------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select is(public.am_i_admin(), true, 'an admin knows it');
select is((public.admin_overview() ->> 'users')::int, 2, 'the overview counts people');
select is((public.admin_overview() -> 'by_tier' ->> 'standard')::int, 2, 'and plans');
select is((select count(*)::int from public.admin_list_users('person')), 1, 'users can be searched by email');
select is((select labs_owned from public.admin_list_users('person')), 0::bigint, 'with lab counts, not lab contents');

select lives_ok($$ select public.admin_set_tier('00000000-0000-0000-0000-00000000000b', 'paid1') $$, 'an admin changes a plan');
select throws_ok($$ select public.admin_set_tier('00000000-0000-0000-0000-00000000000b', 'gold') $$, '22023', null, 'plans are checked');
select is((select tier from public.admin_list_users('person')), 'paid1', 'the plan changed');
select lives_ok($$ select public.admin_set_early_access('00000000-0000-0000-0000-00000000000b', true) $$, 'an admin grants early access');

select lives_ok($$ select public.admin_approve_waitlist('00000000-0000-0000-0000-0000000000f1') $$, 'an admin approves a waitlist entry');
select throws_ok($$ select public.admin_approve_waitlist('00000000-0000-0000-0000-0000000000f1') $$, 'P0002', null, 'twice is refused');

select lives_ok($$ select public.admin_set_setting('max_users', '40') $$, 'an admin raises the cap');
select throws_ok($$ select public.admin_set_setting('max_users', '"many"') $$, '22023', null, 'settings are validated');
select throws_ok($$ select public.admin_set_setting('min_app_version', '"soon"') $$, '22023', null, 'including the version');
select throws_ok($$ select public.admin_set_setting('secret_thing', '1') $$, '22023', 'Unknown setting', 'and only known settings');
select lives_ok($$ select public.admin_set_limit('standard', 'strains', 30) $$, 'an admin changes a limit');

select public.admin_set_flag('new_thing', true, true);
select is((select count(*)::int from public.admin_audit_log(100)), 6, 'every change is in the audit log');

-- Flags follow early access --------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is(public.my_flags(), array['new_thing'], 'an early-access person gets an early-access flag');
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select public.admin_set_early_access('00000000-0000-0000-0000-00000000000b', false);
select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is(public.my_flags(), '{}'::text[], 'without early access, it stays off');

select * from finish();
rollback;

-- Plans, limits, the user cap and the waitlist.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated;
grant execute on all functions in schema tests to authenticated, anon;

-- Profiles ------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com');

select is((select count(*)::int from public.profiles where tier = 'standard' and not early_access), 3, 'every new user gets a standard profile');
select is((select value from public.plan_limits where tier = 'standard' and limit_key = 'labs_owned'), 1, 'standard owns 1 lab');
select is((select value from public.plan_limits where tier = 'special' and limit_key = 'strains'), null, 'special is unlimited');

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.profiles), 1, 'a person sees only their own profile');
select throws_ok($$ update public.profiles set tier = 'special' where user_id = auth.uid() $$, '42501', null, 'nobody changes their own plan');
select is((select count(*)::int from public.plan_limits), 40, 'signed-in users can read the limits');
select throws_ok($$ select * from public.app_settings $$, '42501', null, 'settings are not readable directly');
select throws_ok($$ select * from public.waitlist $$, '42501', null, 'the waitlist is not readable');
select throws_ok($$ select * from public.platform_admins $$, '42501', null, 'admins are not listed');

-- Labs owned / joined ---------------------------------------------------------

insert into tests.v values ('lab', public.create_account('Lab A', 'KA')::text);
select throws_ok($$ select public.create_account('Lab A2', 'KA') $$, 'LM001', 'limit_reached:labs_owned:1', 'a standard user owns one lab');

reset role;
update public.profiles set tier = 'paid1' where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.create_account('Lab A2', 'KA') $$, 'paid 1 owns two');

-- Lab limits follow the owner's plan ---------------------------------------------

reset role;
update public.plan_limits set value = 1 where tier = 'paid1' and limit_key in ('strains', 'members_per_lab', 'pending_invites', 'recipes');
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ insert into public.strains (account_id, name) values ((select val::uuid from tests.v where k = 'lab'), 'One') $$, 'the first strain fits');
select throws_ok($$ insert into public.strains (account_id, name) values ((select val::uuid from tests.v where k = 'lab'), 'Two') $$,
  'LM001', 'limit_reached:strains:1', 'the second is over the owner''s limit');
select lives_ok($$ select public.invite_member((select val::uuid from tests.v where k = 'lab'), 'tech') $$, 'one pending invite fits');
select throws_ok($$ select public.invite_member((select val::uuid from tests.v where k = 'lab'), 'tech') $$,
  'LM001', 'limit_reached:pending_invites:1', 'a second pending invite is refused');

reset role;
update public.plan_limits set value = 3 where tier = 'paid1' and limit_key = 'pending_invites';
update public.plan_limits set value = 2 where tier = 'paid1' and limit_key = 'members_per_lab';
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v select 'c1', code from public.invite_member((select val::uuid from tests.v where k = 'lab'), 'tech');
insert into tests.v select 'c2', code from public.invite_member((select val::uuid from tests.v where k = 'lab'), 'tech');
select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.accept_invite((select val from tests.v where k = 'c1'), 'BB') $$, 'a second member fits');
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.accept_invite((select val from tests.v where k = 'c2'), 'CC') $$,
  'LM001', 'limit_reached:members_per_lab:2', 'a third member is over the lab''s limit');

reset role;
update public.plan_limits set value = 0 where tier = 'standard' and limit_key = 'labs_joined';
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.accept_invite((select val from tests.v where k = 'c2'), 'CC') $$,
  'LM001', 'limit_reached:labs_joined:0', 'joining is limited by the person''s own plan');

-- The user cap and the waitlist ---------------------------------------------------

reset role;
set local role anon;
select is((select (public.signup_status() ->> 'open')::boolean), true, 'signed-out visitors can see that signups are open');
select lives_ok($$ select public.join_waitlist('  Wait@Example.com ') $$, 'anyone can join the waitlist');
select throws_ok($$ select public.join_waitlist('nope') $$, '22023', 'Enter a valid email address.', 'a bad email is refused');
select lives_ok($$ select public.join_waitlist('wait@example.com') $$, 'joining twice is harmless');

reset role;
select is((select count(*)::int from public.waitlist), 1, 'the waitlist holds one lower-cased address');
update public.app_settings set value = '3' where key = 'max_users';
select throws_ok($$ insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd@example.com') $$,
  'LM002', 'signups_closed', 'the cap refuses a new user when full');
set local role anon;
select is((select (public.signup_status() ->> 'open')::boolean), false, 'the sign-in screen is told the app is full');
reset role;
update public.waitlist set approved_at = now() where email = 'wait@example.com';
select lives_ok($$ insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d2', 'Wait@example.com') $$,
  'an approved waitlist email gets in even when full');
update public.app_settings set value = 'false' where key = 'signups_open';
update public.app_settings set value = '100' where key = 'max_users';
select throws_ok($$ insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d3', 'e@example.com') $$,
  'LM002', 'signups_closed', 'closing signups refuses new users even under the cap');

select * from finish();
rollback;

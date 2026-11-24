-- Invites, members and more than one lab per person.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'tech@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'friend@example.com');

create schema tests;
grant usage on schema tests to authenticated;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on all functions in schema tests to authenticated;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v values ('lab', public.create_account('Lab A', 'KL')::text);

-- ---------------------------------------------------------------------------
-- Inviting
-- ---------------------------------------------------------------------------

insert into tests.v select 'tech_code', code from public.invite_member((select val::uuid from tests.v where k = 'lab'), 'tech');
select matches((select val from tests.v where k = 'tech_code'), '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$',
  'codes are 8 characters without look-alikes, in two groups');
select is((select count(*)::int from public.invites), 1, 'the owner sees the invite');
select ok((select code_hash <> replace((select val from tests.v where k = 'tech_code'), '-', '') from public.invites limit 1),
  'only a hash of the code is stored');
select ok((select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from public.invites limit 1),
  'codes expire after 7 days');
select throws_ok($$ select public.invite_member((select val::uuid from tests.v where k = 'lab'), 'admin') $$,
  '22023', 'Role is owner, tech or viewer', 'roles are owner, tech or viewer');

-- ---------------------------------------------------------------------------
-- Accepting
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.invites), 0, 'people outside the lab see no invites');
select throws_ok($$ select public.accept_invite('WRNG-CODE', 'TE') $$,
  'P0002', 'That code isn''t valid. Codes work once and expire after 7 days; ask for a new one.', 'a wrong code is refused');
select is(
  public.accept_invite(lower(replace((select val from tests.v where k = 'tech_code'), '-', ' ')), 'te'),
  (select val::uuid from tests.v where k = 'lab'), 'the right code joins the lab (any case, spaces instead of the dash)');
select is((select row(role, initials)::text from public.members where user_id = '00000000-0000-0000-0000-00000000000b'),
  '(tech,TE)', '... with the invited role and their initials');
select is((select count(*)::int from public.accounts), 1, 'and now sees the lab');
select throws_ok($$ select public.accept_invite((select val from tests.v where k = 'tech_code'), 'TE') $$,
  'P0002', null, 'a code works once');
select throws_ok($$ select public.invite_member((select val::uuid from tests.v where k = 'lab'), 'viewer') $$,
  '42501', 'Only the lab''s owners can invite people', 'techs can''t invite');

-- ---------------------------------------------------------------------------
-- Several labs per person
-- ---------------------------------------------------------------------------

select lives_ok($$ select public.create_account('Tech''s own lab', 'TE') $$, 'a member can also create a lab of their own');
select is((select count(*)::int from public.members where user_id = '00000000-0000-0000-0000-00000000000b'), 2, '... and belongs to both');

-- ---------------------------------------------------------------------------
-- Expired and revoked codes
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v select 'viewer_code', code from public.invite_member((select val::uuid from tests.v where k = 'lab'), 'viewer');
insert into tests.v select 'old_code', code from public.invite_member((select val::uuid from tests.v where k = 'lab'), 'viewer');
update public.invites set revoked_at = now()
where code_hash = private.invite_hash((select val from tests.v where k = 'viewer_code'));
reset role;
update public.invites set expires_at = now() - interval '1 minute'
where code_hash = private.invite_hash((select val from tests.v where k = 'old_code'));
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.accept_invite((select val from tests.v where k = 'viewer_code'), 'FR') $$,
  'P0002', null, 'a revoked code is refused');
select throws_ok($$ select public.accept_invite((select val from tests.v where k = 'old_code'), 'FR') $$,
  'P0002', null, 'an expired code is refused');

-- ---------------------------------------------------------------------------
-- Roles and removing people; always one owner
-- ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select public.set_member_role((select val::uuid from tests.v where k = 'lab'), '00000000-0000-0000-0000-00000000000b', 'owner') $$,
  '42501', 'Only the lab''s owners can change roles', 'techs can''t change roles (not even their own)');
select throws_ok($$ update public.members set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, '... nor by editing their membership (only initials can be changed)');

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select public.set_member_role((select val::uuid from tests.v where k = 'lab'), '00000000-0000-0000-0000-00000000000a', 'tech') $$,
  'P0001', 'A lab needs at least one owner', 'the last owner can''t step down');
select throws_ok(
  $$ select public.remove_member((select val::uuid from tests.v where k = 'lab'), '00000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'A lab needs at least one owner', '... or leave');
select lives_ok(
  $$ select public.set_member_role((select val::uuid from tests.v where k = 'lab'), '00000000-0000-0000-0000-00000000000b', 'owner') $$,
  'an owner can make someone else an owner');
select lives_ok(
  $$ select public.set_member_role((select val::uuid from tests.v where k = 'lab'), '00000000-0000-0000-0000-00000000000a', 'viewer') $$,
  '... and then step down');

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.remove_member((select val::uuid from tests.v where k = 'lab'), '00000000-0000-0000-0000-00000000000a') $$,
  'an owner can remove someone');
select is((select count(*)::int from public.members where account_id = (select val::uuid from tests.v where k = 'lab')), 1,
  '... who leaves the lab');

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.accounts), 0, 'and no longer sees it');

reset role;
select ok(not has_function_privilege('anon', 'public.accept_invite(text, text)', 'execute'), 'signed-out users can''t use codes');

select * from finish();
rollback;

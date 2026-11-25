-- Account deletion (30-day grace, then really removed) and data export.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'tech@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'solo@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'outsider@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000f', 'later-owner@example.com'),
  ('00000000-0000-0000-0000-000000000010', 'joiner@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000e');
update public.profiles set tier = 'special';

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated;
grant execute on all functions in schema tests to authenticated, anon;

set local role authenticated;

-- Lab A: owner + tech. Lab S: solo owner. Each with a strain and a culture.
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v values ('a', public.create_account('Lab A', 'OA')::text);
insert into tests.v select 'code', code from public.invite_member((select val::uuid from tests.v where k = 'a'), 'tech');
select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select public.accept_invite((select val from tests.v where k = 'code'), 'TB');
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
insert into tests.v values ('s', public.create_account('Lab S', 'SO')::text);

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into public.strains (id, account_id, name) values ('00000000-0000-0000-0000-0000000000a1', (select val::uuid from tests.v where k = 'a'), 'Blue Oyster');
insert into public.items (account_id, strain_id, kind, medium, origin_prefix, initials)
  values ((select val::uuid from tests.v where k = 'a'), '00000000-0000-0000-0000-0000000000a1', 'origin', 'spore_print', 'S', 'OA');
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
insert into public.strains (id, account_id, name) values ('00000000-0000-0000-0000-0000000000c1', (select val::uuid from tests.v where k = 's'), 'Solo Reishi');

-- Export ---------------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select is(jsonb_array_length(public.export_lab((select val::uuid from tests.v where k = 'a')) -> 'cultures'), 1, 'a member exports their lab''s cultures');
select is(public.export_lab((select val::uuid from tests.v where k = 'a')) -> 'lab' ->> 'name', 'Lab A', 'with the lab');
select is(jsonb_array_length(public.export_lab((select val::uuid from tests.v where k = 'a')) -> 'members'), 2, 'and who is in it, by initials');
select ok(not (public.export_lab((select val::uuid from tests.v where k = 'a'))::text like '%@example.com%'), 'with no email addresses');
select tests.sign_in('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.export_lab((select val::uuid from tests.v where k = 'a')) $$, '42501', 'Not a member of this lab', 'outsiders can''t export it');

-- Asking to delete ---------------------------------------------------------------------

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.request_account_deletion() $$, 'P0001', null, 'the only owner of a lab with others must hand it over first');
select is((select count(*)::int from public.deletion_requests), 0, 'and nothing was recorded');

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.request_account_deletion() $$, 'a tech can ask to delete their account');
select is((select count(*)::int from public.members where user_id = '00000000-0000-0000-0000-00000000000b'), 0, 'they leave their labs straight away');
select is((select count(*)::int from public.deletion_requests), 1, 'and see their request');
select ok((select purge_after > now() + interval '29 days' from public.deletion_requests), 'with 30 days to change their mind');

select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select lives_ok($$ select public.request_account_deletion() $$, 'a solo owner can ask too');
select is((select count(*)::int from public.members where user_id = '00000000-0000-0000-0000-00000000000c'), 1, 'their lab waits for the grace period');
select lives_ok($$ select public.cancel_account_deletion() $$, 'and they can cancel');
select is((select count(*)::int from public.deletion_requests), 0, 'which removes the request');
select public.request_account_deletion();

-- Purging ---------------------------------------------------------------------------------

reset role;
select is(private.purge_due_accounts(), 0, 'nothing is removed before the 30 days are up');
update public.deletion_requests set purge_after = now() - interval '1 day';
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.admin_purge_due_accounts() $$, '42501', null, 'only admins run the purge by hand');
select tests.sign_in('00000000-0000-0000-0000-00000000000e');
select is(public.admin_purge_due_accounts(), 2, 'an admin purges the two due accounts');
reset role;
select is((select count(*)::int from auth.users where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c')), 0, 'they are gone');
select is((select count(*)::int from public.accounts where name = 'Lab S'), 0, 'the lab they were alone in is gone');
select is((select count(*)::int from public.items), 1, 'but Lab A''s cultures, made with the tech''s help, remain');

-- Someone who joined a lab during the grace period inherits it.
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000f');
insert into tests.v values ('t', public.create_account('Lab T', 'LO')::text);
select public.request_account_deletion();
insert into tests.v select 'tcode', code from public.invite_member((select val::uuid from tests.v where k = 't'), 'viewer');
select tests.sign_in('00000000-0000-0000-0000-000000000010');
select public.accept_invite((select val from tests.v where k = 'tcode'), 'JN');
reset role;
update public.deletion_requests set purge_after = now() - interval '1 day';
select private.purge_due_accounts();
select is((select role from public.members where account_id = (select val::uuid from tests.v where k = 't')), 'owner', 'a lab that gained a member during the grace period passes to them');

select * from finish();
rollback;

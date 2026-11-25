-- Feedback: saved only through send_feedback() (validated, rate limited per plan),
-- visible to its sender and to admins, never to other people.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'sender@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'other@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000a');

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated;
grant execute on all functions in schema tests to authenticated, anon;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000b');

insert into tests.v values ('first', public.send_feedback('bug', '  The label sheet cut off  ', '{"version":"1.0.0","platform":"ios"}')::text);
select is((select message from public.feedback), 'The label sheet cut off', 'a person sends feedback; it is trimmed and saved');
select is((select diagnostics ->> 'platform' from public.feedback), 'ios', 'with the diagnostics they chose to send');
select is((select status from public.feedback), 'new', 'new feedback is marked new');

select throws_ok($$ insert into public.feedback (kind, message) values ('bug', 'direct') $$, '42501', null, 'feedback can''t be inserted directly');
select throws_ok($$ update public.feedback set status = 'done' $$, '42501', null, 'senders can''t change it');
select throws_ok($$ select public.send_feedback('rant', 'x') $$, '22023', 'Kind is bug, idea or question', 'the kind is checked');
select throws_ok($$ select public.send_feedback('bug', '   ') $$, '22023', 'Write a message first.', 'an empty message is refused');
select throws_ok($$ select public.send_feedback('bug', 'x', jsonb_build_object('blob', repeat('x', 3000))) $$, '22023', 'Diagnostics are too large', 'diagnostics stay small');

select public.send_feedback('idea', 'two');
select public.send_feedback('idea', 'three');
select public.send_feedback('idea', 'four');
select public.send_feedback('idea', 'five');
select throws_ok($$ select public.send_feedback('idea', 'six') $$, 'LM001', 'limit_reached:feedback_per_day:5', 'a standard plan sends 5 a day');

select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.feedback), 0, 'other people can''t read it');
select throws_ok($$ select * from public.admin_list_feedback() $$, '42501', null, 'the inbox is admin only');

select tests.sign_in('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.admin_list_feedback()), 5, 'an admin sees the inbox');
select is((select email from public.admin_list_feedback() where message = 'The label sheet cut off'), 'sender@example.com', 'with who sent each');
select is((select count(*)::int from public.admin_list_feedback('done')), 0, 'and can filter by status');
select lives_ok($$ select public.admin_set_feedback_status((select val::uuid from tests.v where k = 'first'), 'done') $$, 'an admin marks one done');
select throws_ok($$ select public.admin_set_feedback_status((select val::uuid from tests.v where k = 'first'), 'later') $$, '22023', null, 'statuses are checked');
select is((select count(*)::int from public.admin_audit_log(10) where action = 'set_feedback_status'), 1, 'and it is audited');
reset role;
select is((select count(*)::int from public.feedback where status = 'done'), 1, 'the status changed');

select * from finish();
rollback;

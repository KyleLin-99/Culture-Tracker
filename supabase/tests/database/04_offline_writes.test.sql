-- Changes made on a phone while offline: idempotent, and code conflicts
-- resolved with relabels. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

create schema tests;
grant usage on schema tests to authenticated;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function tests.item(p_code text) returns uuid language sql as $$
  select id from public.items where code = p_code;
$$;
create function tests.acct() returns uuid language sql as $$
  select account_id from public.members where user_id = auth.uid();
$$;
-- One item for apply_items, as a phone would send it.
create function tests.planned(p_id uuid, p_parent text, p_kind text, p_position int, p_backup int, p_expected text,
                              p_prefix text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'account_id', tests.acct(), 'strain_id', '10000000-0000-0000-0000-000000000001',
    'parent_id', tests.item(p_parent), 'kind', p_kind, 'medium', case when p_kind = 'origin' then 'tissue' else 'agar' end,
    'origin_prefix', p_prefix, 'position', p_position, 'backup_number', p_backup,
    'made_on', current_date, 'expected_code', p_expected);
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'KL'); end $$;
insert into public.strains (id, account_id, name) values ('10000000-0000-0000-0000-000000000001', tests.acct(), 'Blue Oyster');
insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
values (tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S');
do $$ begin perform public.create_transfers(tests.item('S'), 2, 'agar'); end $$;  -- S-1, S-2

-- ---------------------------------------------------------------------------
-- No conflict
-- ---------------------------------------------------------------------------

select is(
  (select code from public.apply_items(jsonb_build_array(
     tests.planned('20000000-0000-0000-0000-000000000001', 'S-1', 'transfer', 1, null, 'S-1A')))),
  'S-1A', 'a phone-made transfer keeps its id and planned code');
select is((select count(*)::int from public.relabels), 0, 'no relabel when the code is as planned');

select is(
  (select code from public.apply_items(jsonb_build_array(
     tests.planned('20000000-0000-0000-0000-000000000001', 'S-1', 'transfer', 1, null, 'S-1A')))),
  'S-1A', 'sending the same change again returns the stored row');
select is((select count(*)::int from public.items where parent_id = tests.item('S-1')), 1, '... and creates nothing new');

-- ---------------------------------------------------------------------------
-- Conflicts: another device got there first
-- ---------------------------------------------------------------------------

-- The other device (online) makes S-2A first.
do $$ begin perform public.create_transfers(tests.item('S-2'), 1, 'agar'); end $$;

-- This phone also planned S-2A, plus a child of it, S-2A1.
select is(
  (select array_agg(code) from public.apply_items(jsonb_build_array(
     tests.planned('20000000-0000-0000-0000-000000000002', 'S-2', 'transfer', 1, null, 'S-2A'),
     jsonb_set(tests.planned('20000000-0000-0000-0000-000000000003', 'S-2', 'transfer', 1, null, 'S-2A1'),
               '{parent_id}', '"20000000-0000-0000-0000-000000000002"')))),
  array['S-2B', 'S-2B1'], 'a taken position moves to the next free one, and its children follow');

select is(
  (select array_agg(old_code || '>' || new_code order by new_code) from public.relabels),
  array['S-2A>S-2B', 'S-2A1>S-2B1'], 'both plates are listed for relabeling');

select is((select code from public.items where id = tests.item('S-2A')), 'S-2A', 'the first device keeps its code');

-- Backups: S-2(1) made online; this phone also planned S-2(1).
do $$ begin perform public.create_backups(tests.item('S-2'), 1); end $$;
select is(
  (select code from public.apply_items(jsonb_build_array(
     tests.planned('20000000-0000-0000-0000-000000000004', 'S-2', 'backup', null, 1, 'S-2(1)')))),
  'S-2(2)', 'a taken backup number moves to the next one');

-- Origins: a second "W" made offline becomes W2.
insert into public.items (account_id, strain_id, kind, medium, origin_prefix)
values (tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'tissue', 'W');
select is(
  (select code from public.apply_items(jsonb_build_array(
     tests.planned('20000000-0000-0000-0000-000000000005', null, 'origin', null, null, 'W', 'W')))),
  'W2', 'an origin planned as W becomes W2 when W exists');
select is((select new_code from public.relabels where old_code = 'W'), 'W2', '... with a relabel');

select is(
  (select code from public.apply_items(jsonb_build_array(
     tests.planned('20000000-0000-0000-0000-000000000006', 'S-2', 'transfer', 2, null, 'S-2B')))),
  'S-2C', 'the fallback takes the next free position even past several taken ones');

-- ---------------------------------------------------------------------------
-- Status changes and events
-- ---------------------------------------------------------------------------

select is(
  (public.apply_status('30000000-0000-0000-0000-000000000001', tests.item('S-1A'), 'contaminated', null, 'trich')).status,
  'contaminated', 'apply_status changes the status');
do $$ begin
  perform public.apply_status('30000000-0000-0000-0000-000000000001', tests.item('S-1A'), 'contaminated', null, 'trich');
end $$;
select is((select count(*)::int from public.events where item_id = tests.item('S-1A') and type = 'contaminated'), 1,
  'sending the same status change twice logs one event');

do $$ begin
  perform public.apply_event('30000000-0000-0000-0000-000000000002', tests.item('S-1'), 'note', 'fast');
  perform public.apply_event('30000000-0000-0000-0000-000000000002', tests.item('S-1'), 'note', 'fast');
end $$;
select is((select count(*)::int from public.events where id = '30000000-0000-0000-0000-000000000002'), 1,
  'apply_event is idempotent');

select throws_ok(
  $$ select public.apply_event(gen_random_uuid(), gen_random_uuid(), 'note', 'x') $$,
  'P0002', 'Item not found', 'apply_event refuses an unknown item');

-- ---------------------------------------------------------------------------
-- Relabels are resolved, and stay in their lab
-- ---------------------------------------------------------------------------

update public.relabels set resolved_at = now() where old_code = 'W';
select is((select count(*)::int from public.relabels where resolved_at is null), 4, 'a relabel can be marked done');

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
do $$ begin perform public.create_account('Lab B', 'BB'); end $$;
select is((select count(*)::int from public.relabels), 0, 'B can''t see A''s relabels');
select throws_ok(
  $$ select public.apply_items(jsonb_build_array(jsonb_build_object(
       'id', gen_random_uuid(), 'account_id', tests.acct(), 'parent_id', '20000000-0000-0000-0000-000000000001',
       'kind', 'transfer', 'medium', 'agar', 'position', 9, 'expected_code', 'S-1A9'))) $$,
  null, null, 'B can''t add a transfer under A''s culture');

select * from finish();
rollback;

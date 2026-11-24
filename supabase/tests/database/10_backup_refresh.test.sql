-- Refreshing backups: from the parent while it's active, else grown from the backup;
-- the link is checked and fixed; phones send it through apply_items.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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
create function tests.id(p_code text) returns uuid language sql as $$
  select id from public.items where code = p_code;
$$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'KL'); end $$;
insert into public.strains (id, account_id, name) values ('10000000-0000-0000-0000-000000000001', tests.acct(), 'Blue Oyster');
insert into public.items (id, account_id, strain_id, kind, medium, origin_prefix, made_on)
values ('20000000-0000-0000-0000-000000000001', tests.acct(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S', '2026-01-01');
do $$
begin
  perform public.create_transfers('20000000-0000-0000-0000-000000000001', 2, 'agar', '2026-01-10');
  perform public.create_backups(tests.id('S-1'), 2, 'slant', '2026-01-20');
  perform public.create_backups(tests.id('S-2'), 1, 'slant', '2026-01-20');
  perform public.set_item_status(tests.id('S-2'), 'used');
end $$;

-- ---------------------------------------------------------------------------
-- Parent still active: a new backup from it, same generation
-- ---------------------------------------------------------------------------

create temp table r1 as select * from public.refresh_backup(tests.id('S-1(1)'), '2026-11-27');
select is((select concat_ws(' ', code, kind, generation, made_on) from r1), 'S-1(3) backup 1 2026-11-27',
  'parent active: a new backup from the parent, numbered after the existing ones');
select is((select refresh_of from r1), tests.id('S-1(1)'), '... linked to the backup it refreshes');
select is((select status from public.items where code = 'S-1(1)'), 'active', 'the old backup stays until retired');
select ok(exists (select 1 from public.events where item_id = tests.id('S-1') and type = 'backed_up'
  and note = '1 × slant backup: S-1(3) (refresh of S-1(1))'), 'the parent''s history says so');

-- ---------------------------------------------------------------------------
-- Parent gone: grown from the old backup
-- ---------------------------------------------------------------------------

create temp table r2 as select * from public.refresh_backup(tests.id('S-2(1)'), '2026-11-27');
select is((select concat_ws(' ', code, kind, medium) from r2), 'S-2(1)-1 transfer slant',
  'parent used up: a culture grown from the backup (revival)');
select is((select refresh_of from r2), tests.id('S-2(1)'), '... linked to it');

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.refresh_backup(tests.id('S-1'), '2026-11-27') $$,
  '22023', 'Only a backup can be refreshed', 'only backups');
select throws_ok(
  $$ insert into public.items (account_id, strain_id, parent_id, kind, medium, refresh_of)
     values (tests.acct(), '10000000-0000-0000-0000-000000000001', tests.id('S-2'), 'backup', 'slant', tests.id('S-1(2)')) $$,
  '22023', 'A refresh is a new backup from the same parent, or grown from the old backup',
  'a refresh must be a sibling backup or grown from the old backup');
select throws_ok(
  $$ update public.items set refresh_of = null where id = (select id from r1) $$,
  '23514', 'An item''s lineage and culture code can''t be changed', 'the link is fixed once written');

-- Phones: apply_items stores refresh_of.
select is(
  (select refresh_of from public.apply_items(jsonb_build_array(jsonb_build_object(
     'id', '50000000-0000-0000-0000-000000000001', 'account_id', tests.acct(),
     'strain_id', '10000000-0000-0000-0000-000000000001', 'parent_id', tests.id('S-1'), 'kind', 'backup',
     'medium', 'slant', 'backup_number', 4, 'made_on', '2026-11-27', 'refresh_of', tests.id('S-1(2)'),
     'expected_code', 'S-1(4)')))),
  tests.id('S-1(2)'), 'apply_items (phones) stores the refresh link');

select tests.sign_in('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.refresh_backup((select id from r1), '2026-11-27') $$,
  'P0002', 'Culture not found', 'another lab can''t refresh this lab''s backups');

reset role;
select ok(not has_function_privilege('anon', 'public.refresh_backup(uuid, date)', 'execute'), 'signed-out users can''t refresh');

select * from finish();
rollback;

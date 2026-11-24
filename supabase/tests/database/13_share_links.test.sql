-- Shared lineage links: what signed-out visitors can (and can't) see.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'other@example.com');

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function tests.lab() returns uuid language sql as $$ select account_id from public.members where user_id = auth.uid() limit 1 $$;
create function tests.id(p_code text) returns uuid language sql as $$ select id from public.items where code = p_code $$;
grant execute on all functions in schema tests to authenticated, anon;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated, anon;

set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.create_account('Lab A', 'KL'); end $$;
insert into public.strains (id, account_id, name, species) values
  ('10000000-0000-0000-0000-000000000001', tests.lab(), 'Blue Oyster', 'Pleurotus ostreatus'),
  ('10000000-0000-0000-0000-000000000002', tests.lab(), 'Secret Strain', null);
insert into public.items (account_id, strain_id, kind, medium, origin_prefix, notes) values
  (tests.lab(), '10000000-0000-0000-0000-000000000001', 'origin', 'spore_print', 'S', 'private note'),
  (tests.lab(), '10000000-0000-0000-0000-000000000002', 'origin', 'swab', 'W', null);
do $$ begin perform public.create_transfers(tests.id('S'), 2, 'agar'); end $$;
insert into public.events (account_id, item_id, type, note) values (tests.lab(), tests.id('S-1'), 'note', 'private event');

-- ---------------------------------------------------------------------------
-- Making links
-- ---------------------------------------------------------------------------

insert into tests.v select 'token', token from public.create_share_link('10000000-0000-0000-0000-000000000001');
select matches((select val from tests.v where k = 'token'), '^[a-hjkmnp-z2-9]{26}$', 'tokens are 26 random characters');
select ok((select expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour' from public.share_links),
  'links expire after 30 days by default');
select ok((select token_hash <> (select val from tests.v where k = 'token') from public.share_links), 'only a hash is stored');
select throws_ok($$ select public.create_share_link('10000000-0000-0000-0000-000000000001', 400) $$,
  '22023', 'Links last from 1 to 365 days', 'at most a year');

reset role;
insert into public.members (account_id, user_id, role, initials)
values ((select id from public.accounts), '00000000-0000-0000-0000-00000000000c', 'viewer', 'VI');
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.create_share_link('10000000-0000-0000-0000-000000000001') $$,
  '42501', 'Viewers can''t share lineage', 'viewers can''t make links');
select tests.sign_in('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.create_share_link('10000000-0000-0000-0000-000000000001') $$,
  'P0002', 'Strain not found', 'another lab can''t make links to this strain');

-- ---------------------------------------------------------------------------
-- What a signed-out visitor sees
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
create temp table shown as select public.shared_lineage((select val from tests.v where k = 'token')) as j;
grant select on shown to anon;
select is((select j -> 'strain' from shown), '{"name": "Blue Oyster", "species": "Pleurotus ostreatus"}'::jsonb,
  'a visitor sees the strain''s name and species');
select is((select jsonb_agg(e ->> 'code') from shown, jsonb_array_elements(j -> 'tree') e), '["S", "S-1", "S-2"]'::jsonb,
  '... and its tree, in tree order');
select is((select (j -> 'tree' -> 1) ->> 'parent_code' from shown), 'S', 'parents are shown by code');
select is((select array_agg(distinct k order by k) from shown, jsonb_array_elements(j -> 'tree') e, jsonb_object_keys(e) k),
  array['code', 'depth', 'generation', 'kind', 'made_on', 'medium', 'parent_code', 'status'],
  'no ids, initials or notes in the tree');
select ok((select position('private' in j::text) = 0 and position('Secret' in j::text) = 0
           and position('Lab A' in j::text) = 0 and position('KL' in j::text) = 0 from shown),
  'nothing from notes, other strains, the lab''s name or initials');
select throws_ok($$ select public.shared_lineage('not-a-real-token-at-all-xx') $$,
  'P0002', 'This link has expired or been turned off. Ask for a new one.', 'a wrong token shows nothing');
select throws_ok($$ select * from public.share_links $$, '42501', null, 'visitors can''t list links');
select throws_ok($$ select * from public.items $$, '42501', null, '... or read cultures directly');
select throws_ok($$ select public.lookup_code('S') $$, '42501', null, '... or call the lab''s other functions');
select throws_ok($$ select public.create_share_link('10000000-0000-0000-0000-000000000001') $$,
  '42501', null, '... or make links');

-- ---------------------------------------------------------------------------
-- Revoked and expired links
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
update public.share_links set revoked_at = now();
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.shared_lineage((select val from tests.v where k = 'token')) $$,
  'P0002', null, 'a revoked link stops working');

reset role;
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v select 'token2', token from public.create_share_link('10000000-0000-0000-0000-000000000001', 1);
reset role;
update public.share_links set expires_at = now() - interval '1 second' where revoked_at is null;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.shared_lineage((select val from tests.v where k = 'token2')) $$,
  'P0002', null, 'an expired link stops working');

-- Viewers can see the lab's links (to know what's shared) but not turn them off.
reset role;
set local role authenticated;
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.share_links), 2, 'members see the lab''s links');
update public.share_links set revoked_at = null;
reset role;
select is((select count(*)::int from public.share_links where revoked_at is null), 1, 'viewers can''t turn links back on');

select * from finish();
rollback;

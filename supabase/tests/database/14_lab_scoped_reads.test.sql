-- Lists follow the lab you're working in (lookup_code, stats_rows, contamination_trace).
-- Bug: someone in two labs saw both labs' strains and plates after switching labs,
-- because row-level security allows every lab you belong to and these functions
-- never named the current lab. With p_account_id they return only that lab; without
-- it, every lab you belong to (the mcp-server still calls them that way).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'two-labs@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'other@example.com');

create schema tests;
grant usage on schema tests to authenticated;
create function tests.sign_in(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create table tests.v (k text primary key, val text);
grant all on tests.v to authenticated;
create function tests.id(p_key text) returns uuid language sql as $$
  select val::uuid from tests.v where k = p_key;
$$;
grant execute on all functions in schema tests to authenticated;

-- One small lab: an origin with 2 plates made 2026-11-01 (p_contaminated of them
-- contaminated, at least one clean) and 1 clean plate made 2026-11-02.
create function tests.seed(p_lab uuid, p_strain uuid, p_name text, p_plates int, p_contaminated int)
returns void language plpgsql as $$
declare
  origin uuid := gen_random_uuid();
  ids uuid[];
begin
  insert into public.strains (id, account_id, name) values (p_strain, p_lab, p_name);
  insert into public.items (id, account_id, strain_id, kind, medium, origin_prefix, made_on)
  values (origin, p_lab, p_strain, 'origin', 'spore_print', 'S', '2026-10-01');
  select array_agg(id order by position) into ids
  from public.create_transfers(origin, p_plates, 'agar', '2026-11-01');
  for i in 1..p_contaminated loop
    perform public.set_item_status(ids[i], 'contaminated');
  end loop;
  perform public.create_transfers(origin, 1, 'agar', '2026-11-02');
end $$;
grant execute on all functions in schema tests to authenticated;

set local role authenticated;

-- Someone else's lab, with data, that the two-lab member doesn't belong to.
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
insert into tests.v values ('lab_c', public.create_account('Lab C', 'OT')::text);
select tests.seed(tests.id('lab_c'), '10000000-0000-0000-0000-00000000000c', 'Reishi', 2, 1);

-- The member belongs to two labs, each with its own strain and plates.
-- Lab A: origin + 2 + 1 plates (1 contaminated). Lab B: origin + 3 + 1 plates (2 contaminated).
select tests.sign_in('00000000-0000-0000-0000-00000000000a');
insert into tests.v values ('lab_a', public.create_account('Lab A', 'KL')::text);
insert into tests.v values ('lab_b', public.create_account('Lab B', 'KL')::text);
select tests.seed(tests.id('lab_a'), '10000000-0000-0000-0000-00000000000a', 'Blue Oyster', 2, 1);
select tests.seed(tests.id('lab_b'), '10000000-0000-0000-0000-00000000000b', 'Lions Mane', 3, 2);

-- ---------------------------------------------------------------------------
-- lookup_code
-- ---------------------------------------------------------------------------

select is((select array_agg(distinct strain_name) from public.lookup_code('S', tests.id('lab_a'))),
  array['Blue Oyster'], 'lookup_code for lab A finds only lab A''s cultures');
select is((select array_agg(distinct strain_name) from public.lookup_code('S', tests.id('lab_b'))),
  array['Lions Mane'], 'lookup_code for lab B finds only lab B''s cultures');
select is((select array_agg(distinct strain_name order by strain_name) from public.lookup_code('S')),
  array['Blue Oyster', 'Lions Mane'], 'lookup_code without a lab finds every lab you belong to');
select is((select count(*)::int from public.lookup_code('S', tests.id('lab_c'))), 0,
  'lookup_code for a lab you don''t belong to finds nothing');

-- ---------------------------------------------------------------------------
-- stats_rows
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.stats_rows('2026-10-15', '2026-11-30', tests.id('lab_a'))), 3,
  'stats_rows for lab A counts only lab A''s 3 plates');
select is((select count(*)::int from public.stats_rows('2026-10-15', '2026-11-30', tests.id('lab_b'))), 4,
  'stats_rows for lab B counts only lab B''s 4 plates');
select is((select count(*)::int from public.stats_rows('2026-10-15', '2026-11-30')), 7,
  'stats_rows without a lab counts every lab you belong to');
select is((select count(*)::int from public.stats_rows('2026-10-15', '2026-11-30', tests.id('lab_c'))), 0,
  'stats_rows for a lab you don''t belong to returns nothing');

-- ---------------------------------------------------------------------------
-- contamination_trace (contaminated_total is the cohort's contaminated plates)
-- ---------------------------------------------------------------------------

select is((select array_agg(distinct contaminated_total)
           from public.contamination_trace('2026-10-15', '2026-11-30', null, tests.id('lab_a'))),
  array[1], 'contamination_trace for lab A compares only lab A''s plates');
select is((select array_agg(distinct contaminated_total)
           from public.contamination_trace('2026-10-15', '2026-11-30', null, tests.id('lab_b'))),
  array[2], 'contamination_trace for lab B compares only lab B''s plates');
select is((select array_agg(distinct contaminated_total)
           from public.contamination_trace('2026-10-15', '2026-11-30')),
  array[3], 'contamination_trace without a lab compares every lab you belong to');
select is((select count(*)::int
           from public.contamination_trace('2026-10-15', '2026-11-30', null, tests.id('lab_c'))), 0,
  'contamination_trace for a lab you don''t belong to returns nothing');

-- Lab C does have data: the empty answers above are row-level security, not an empty lab.
select tests.sign_in('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.lookup_code('S', tests.id('lab_c'))), 4,
  'lab C''s own member finds its cultures');

select * from finish();
rollback;

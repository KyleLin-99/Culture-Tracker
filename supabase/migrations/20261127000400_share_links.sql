-- Lab sharing, part 4: a read-only link to one strain's lineage, for when a culture
-- changes hands (docs/design/lab-sharing.md). The only thing signed-out visitors
-- can read, so it's deliberately narrow:
--   * only a SHA-256 hash of the token is stored; tokens are 26 random characters
--   * links expire (30 days by default, at most a year) and can be revoked
--   * shared_lineage() returns one strain's tree: codes, kind, medium, status,
--     generation, date made and depth. No ids, initials, notes, lab name, or
--     anything about other strains.

create table public.share_links (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  strain_id   uuid not null,
  token_hash  text not null unique,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  unique (account_id, id),
  foreign key (account_id, strain_id) references public.strains (account_id, id)
);

create index share_links_strain_idx on public.share_links (strain_id, created_at desc);

alter table public.share_links enable row level security;
create policy "members read"    on public.share_links for select to authenticated using (private.is_member(account_id));
create policy "writers insert"  on public.share_links for insert to authenticated with check (private.can_write(account_id));
create policy "writers revoke"  on public.share_links for update to authenticated
  using (private.can_write(account_id)) with check (private.can_write(account_id));
revoke all on public.share_links from anon, authenticated;
grant select, insert, update (revoked_at) on public.share_links to authenticated;

create function private.share_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;
revoke all on function private.share_hash(text) from public;
grant execute on function private.share_hash(text) to authenticated, anon;

-- Makes a link for a strain the caller can write to. Returns the token once.
create function public.create_share_link(p_strain_id uuid, p_days integer default 30)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  raw  bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  -- The random bytes of three v4 UUIDs (skipping the version/variant bytes 6 and 8).
  picks int[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25, 26, 27, 28, 29];
  t    text := '';
  i    int;
  s    public.strains;
  link public.share_links;
begin
  select * into s from public.strains where strains.id = p_strain_id and deleted_at is null;
  if not found then
    raise exception 'Strain not found' using errcode = 'P0002';
  end if;
  if not private.can_write(s.account_id) then
    raise exception 'Viewers can''t share lineage' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Links last from 1 to 365 days' using errcode = '22023';
  end if;
  foreach i in array picks loop
    t := t || substr(alphabet, get_byte(raw, i) % length(alphabet) + 1, 1);
  end loop;
  insert into public.share_links (account_id, strain_id, token_hash, expires_at)
  values (s.account_id, s.id, private.share_hash(t), now() + make_interval(days => p_days))
  returning * into link;
  return query select link.id, t, link.expires_at;
end;
$$;

-- What a link shows. Security definer: visitors are signed out, so RLS would show
-- them nothing. It reads only the strain the token's link points at.
create function public.shared_lineage(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  link public.share_links;
  s    public.strains;
begin
  select * into link from public.share_links
  where token_hash = private.share_hash(p_token) and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'This link has expired or been turned off. Ask for a new one.' using errcode = 'P0002';
  end if;
  select * into s from public.strains where id = link.strain_id and deleted_at is null;
  if not found then
    raise exception 'This link has expired or been turned off. Ask for a new one.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'strain', jsonb_build_object('name', s.name, 'species', s.species),
    'expires_at', link.expires_at,
    'tree', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'parent_code', p.code, 'kind', t.kind, 'medium', t.medium, 'status', t.status,
               'generation', t.generation, 'made_on', t.made_on, 'depth', t.depth) order by t.ord)
      from (select st.*, row_number() over () as ord from public.strain_tree(s.id) st) t
      left join public.items p on p.id = t.parent_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_share_link(uuid, integer) from public, anon;
grant execute on function public.create_share_link(uuid, integer) to authenticated;
revoke all on function public.shared_lineage(text) from public;
grant execute on function public.shared_lineage(text) to anon, authenticated;

# Lab sharing and roles (design, not built)

Status: **decided 2026-11-24** (Kyle accepted every recommendation below), being
built in the 4 PRs listed under "PRs, in order".

Decisions: invites by one-time code; techs can save recipe versions but not change
lab settings; a person can belong to several labs; shared lineage links, tree only,
expiring after 30 days by default; stay on the Supabase free plan for now.

## Goal

1. **Teams:** several people work in one lab, each with their own sign-in and
   initials on labels, with roles so not everyone can change everything.
2. **Viewers ("friends"):** another grower can look at your lab read-only.
3. **Shared lineage:** when a culture changes hands, send a link that shows that
   strain's family tree, without an account.

Phase 1 is teams + viewers (same mechanism). Phase 3 (links) is separate,
because it is the first thing anyone signed out could read.

## Where things stand

- `accounts` (one per lab) and `members (account_id, user_id, role, initials)`.
  `role` is `owner | member`, but nothing checks it: every policy uses
  `private.is_member(account_id)`, so every member can do everything.
- `create_account()` refuses a second lab per user ("You already belong to a lab
  account"); the app loads one membership after sign-in.
- Every table has `account_id`, RLS, and composite foreign keys, so adding people
  needs no table rewrites.
- Phones keep a copy of one lab and clear it when a different lab signs in.

## Roles

| Can… | Owner | Tech | Viewer |
|---|---|---|---|
| See everything in the lab (cultures, lineage, trace, stats, recipes) | ✓ | ✓ | ✓ |
| Transfer, back up, mark status, notes, growth checks, print labels | ✓ | ✓ | – |
| Strains, origins, runs, batches | ✓ | ✓ | – |
| Recipes (save new versions, archive) | ✓ | ✓ (open question) | – |
| Lab settings (backup refresh ages) | ✓ | – (open question) | – |
| Invite and remove people, change roles, rename the lab | ✓ | – | – |
| Change own initials | ✓ | ✓ | ✓ |

A lab always has at least one owner (the last owner can't leave or be demoted).

## Database changes

1. **Roles:** migrate `member` → `tech`; `role in ('owner', 'tech', 'viewer')`.
2. **Helpers** next to `private.is_member()` (same `security definer`, private schema):
   - `private.can_write(account_id)`: member with role owner or tech.
   - `private.is_owner(account_id)`.
3. **Policies:** keep `select` on `is_member` (viewers read); switch every
   `insert`/`update` policy to `can_write` (settings and members: `is_owner`).
   One new migration rewrites the policies table by table; the existing functions
   (`create_transfers`, `apply_check`, …) are `security invoker`, so RLS covers
   them without changes.
4. **Invites** (`invites`: account_id, role, code hash, created_by, expires_at,
   accepted_by, accepted_at), with:
   - `invite_member(account_id, role)` (owner): returns a one-time code.
   - `accept_invite(code, initials)` (`security definer`, checks hash, expiry,
     single use): adds the caller as a member.
   - `set_member_role`, `remove_member` (owner; never the last owner).
5. **More than one lab per user:** drop the one-lab check in `create_account()`
   (needed for viewers, who usually have their own lab too).

Removing someone keeps everything they recorded: rows keep `created_by` and
labels keep their initials.

## App changes

- **Lab switcher** when a user belongs to more than one lab (name in the header;
  switching clears the phone's copy and pulls the other lab, as sign-in does now).
- **Viewers:** action buttons hidden; the phone's writer refuses writes for a
  viewer (same messages as the server), so nothing gets queued that would fail.
- **People screen** (owner): list members with role and initials, invite (shows
  a code and a share sheet), change role, remove.
- **Role changes while offline:** if a tech is made a viewer while their phone is
  offline, their queued changes come back refused and show under "Couldn't save"
  (the existing flow); nothing new needed.

## Shared lineage links (phase 3)

`share_links` (token hash, strain_id, created_by, expires_at, revoked_at) and one
`security definer` function callable signed-out, `shared_lineage(token)`, that
returns only that strain's tree (codes, media, dates, status; no notes, no
initials). This is the first anon-callable function, so it gets its own PR, its
own review, and pgTAP tests that it leaks nothing else (other strains, other labs,
notes, expired or revoked tokens).

## Tests

- pgTAP: a role × table matrix (owner/tech/viewer × read/insert/update on every
  table and every write function), invites (expiry, reuse, wrong code), last-owner
  rules, and the existing isolation tests extended to a user in two labs.
- Integration: a viewer's phone pulls the lab and has writes refused; a tech made
  viewer mid-queue gets "Couldn't save".
- Screens: viewer sees no actions; owner invites and changes roles; lab switcher.

## PRs, in order

1. Roles + policies (no UI change for a solo lab: Kyle stays owner). **Built.**
2. Invites + People screen + more than one lab per user + lab switcher.
3. Viewer mode on phones.
4. Shared lineage links.

## Open questions for Kyle

1. **Invites:** a one-time code you send however you like (text, chat), or email
   invites? Email needs custom SMTP in Supabase, which we skipped earlier; codes
   work today. *Recommended: codes.*
2. **Techs and recipes / settings:** can techs save recipe versions and change
   backup refresh ages, or owner only? *Recommended: recipes yes, settings no.*
3. **Several labs per user:** OK to allow (needed for viewers)? *Recommended: yes.*
4. **Shared lineage links:** wanted at all? If yes, what should a link show, and
   should links expire (e.g. 30 days) by default? *Recommended: yes, 30 days, tree
   only.*
5. **Free tier:** the Supabase free plan caps database size and monthly active
   users. Fine for a few labs; worth a look before opening to many growers.

# Culture Tracker

Lineage records for a gourmet mushroom lab: every culture gets a culture code,
a parent, and a history, so you can trace any plate back to its spore print and
see what happened along the way.

Expo (React Native + TypeScript) for iOS, Android and web · Supabase (Postgres,
Auth, row-level security) · free tiers.

## Culture codes

The database builds every code from the culture's place in the lineage, so a code
can never disagree with its actual parent.

| Part | Rule | Example |
|---|---|---|
| Origin | `S` spore print, `W` wild clone, `C` clone of my fruit, or the initials of the person/company it came from. A number only once a strain has more than one origin with that prefix. Each spore print starts its own chain. | `S`, `S2`, `TBG` |
| Transfer | Starts with a number after the dash, then letters and numbers alternate | `S-2` → `S-2A` → `S-2A1` |
| Backup | Parent code + `(n)` | `S-2A1(2)` |
| Revived from backup | New dash, starts with a number | `S-2A1(2)-1` |
| Limit | 20 characters including dashes and parentheses; longer codes are refused | |

A label reads **strain · date · initials · code**, e.g. `Blue Oyster · 11/16/26 · KL · S-2A1`.
Strain + code is unique, so that combination always identifies one culture.
Only culture work (agar, LC, slants) is tracked; grain and bulk aren't.

## First-time setup (Windows)

You need Node 22+ and Git. Docker Desktop is optional (only for running the
database tests locally).

1. **Install packages**

   ```powershell
   npm install
   ```

2. **Create the Supabase project.** At supabase.com, create a free project
   (region: East US). Save the database password.

3. **Load the schema** into it:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```

4. **Set up sign-in emails.** The app signs in with an emailed code, not a link.
   In the Supabase dashboard, go to **Authentication → Email Templates** and,
   for both **Magic Link** and **Confirm signup**, replace the body with the
   contents of `supabase/templates/sign_in_code.html` (it contains `{{ .Token }}`).
   Supabase's built-in email sender only allows a few emails an hour; if you
   hit that, add a free SMTP provider under **Authentication → SMTP Settings**.

5. **Point the app at your project.** Copy `.env.example` to `.env` and fill in
   the URL and publishable key from **Project Settings → API Keys**.

6. **Run it**

   ```powershell
   npx expo start
   ```

   Press `w` for the web version, or scan the QR code with the Expo Go app on
   your phone (update Expo Go if it says the SDK isn't supported).

7. **Optional: weekly backups.** Push to GitHub, then add a repository secret
   `SUPABASE_DB_URL` with the *Session pooler* connection string from
   **Supabase → Connect**. Then move `ci/db-backup.yml` to
   `.github/workflows/db-backup.yml` (I couldn't write into `.github` from here).
   It dumps the database every Monday, which also keeps the free project from
   pausing.

## Using it

1. Sign in, name your lab and enter your initials.
2. **Strains and new origins** → add a strain → add its origin (spore print,
   clone, or a vendor's initials).
3. Open a culture → **Transfer** → choose how many and onto what. The app shows
   the codes to write on the new labels.
4. From any culture: make a backup, mark it contaminated, retire it, add notes,
   and see its lineage and history. Type a code on the home screen to jump to it.

## Project layout

```
src/
  app/                    Screens (Expo Router: every file is a route)
    _layout.tsx           Auth gate: sign-in → lab setup → app
    sign-in.tsx           Email + code
    onboarding.tsx        Create the lab account
    (app)/index.tsx       Home: code lookup + recent cultures
    (app)/strains/        Strain list, strain family tree + new origin
    (app)/items/[id]/     Culture detail, and transfer (create N children)
  auth/AuthProvider.tsx   Session + lab membership
  domain/                 Culture-code helpers and types
  lib/api.ts              Every database call
  lib/supabase.ts         Supabase client
  ui/                     Buttons, fields, tree list, theme
supabase/
  migrations/             Schema, RLS, culture-code trigger, API functions
  tests/database/         pgTAP tests (codes, lineage, tenant isolation)
  templates/              Sign-in email
```

## Database

- **Tables:** `accounts`, `members`, `strains`, `items` (every culture),
  `events` (history), `media_batches`, `sterilization_runs`.
- **Security:** every table has `account_id` and row-level security; a user
  only ever sees their own lab's rows. Foreign keys include `account_id`, so a
  row can't point at another lab's data. Rows are soft-deleted (`deleted_at`).
- **Codes are permanent:** once written, an item's parent, kind and code can't
  change. Status, location, notes and aliases can.
- **Functions** (called with `supabase.rpc`): `create_account`,
  `create_transfers`, `create_backup`, `set_item_status`, `lookup_code`,
  `item_lineage`, `strain_tree`.

### Tests

With Docker Desktop running:

```powershell
npx supabase start
npx supabase test db
```

57 tests cover the code rules, the 20-character limit, backups and revivals,
lineage queries, and that one lab can't read or write another's data.

## Next (Milestone 2)

Offline-first: expo-sqlite on the phone with an outbox that syncs to Supabase,
so the app works with no signal in the grow space. `updated_at`, client-side
UUIDs, soft deletes and `src/domain/cultureCode.ts` are already in place for it.

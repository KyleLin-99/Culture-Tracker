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
   npx supabase db push --remote
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
   **Supabase → Connect**. The backup workflow (put in place by `ci\install.ps1`)
   dumps the database every Monday, which also keeps the free
   project from pausing.

## Using it

1. Sign in, name your lab and enter your initials.
2. **Strains and new origins** → add a strain → add its origin (spore print,
   clone, or a vendor's initials).
3. Open a culture → **Transfer** → choose how many and onto what. The app shows
   the new codes and can print their labels straight away.
   **Labels** have a QR code plus strain · date · initials · code. Print on a
   Brother 29 × 90 mm or 62 mm roll (AirPrint on iPhone; on Android install
   Brother's *Print Service Plugin*), or on a letter sheet of 30 (Avery 5160).
   **Scan label** on the home screen opens the culture. The QR holds the
   culture's id, so it still works after a relabel.
4. From any culture: make backups, mark it contaminated, retire it, add, edit
   or remove notes, and see its lineage and history. Type a code on the home
   screen to jump to it; **Home** in the header gets you back from anywhere.
5. **Growth checks**: on any culture, log how far it has grown (percent of the
   plate and/or colony radius in mm), offline too. The app works out its growth
   rate and compares it with its ancestors' ("vigor by generation"). A culture
   growing under 70% of its ancestors' average, over 2+ checks, is flagged as
   possibly losing vigor (senescence), so you can go back to an earlier backup.
6. **Backups due**: the home screen lists active backups past their refresh
   age, starting 14 days early (defaults: slants 180 days, LC 120, agar 60,
   other 180; change them in **Lab settings**). Make a fresh backup, then
   retire the old one.
7. **Recipes**: save your agar and LC recipes once (ingredients for a batch
   size, steps). They scale to any volume. Editing saves a new version, so old
   batches keep the version they were made from.
8. **Batches and runs**: log each sterilization or pasteurization run
   (`SR-001`) and the media batches made in it (`MB-001`), picking the recipe
   and how much you made. Then pick the batch when you transfer.
9. **Contamination trace**: ranks what contaminated cultures share that clean
   ones don't (parent, media batch, sterilization run, recipe, day made), with
   relative risk and a Fisher's exact p value.
10. **Stats**: contamination rates over the last 30 days, 90 days or year,
   grouped by recipe, sterilization run, media batch, generation, month or
   strain, and average growth per strain from your growth checks.
11. **Offline on your phone**: the app keeps a copy of your lab (a year of
   history plus everything active) and syncs it in the background. Lookups,
   lineage, transfers, backups, status changes and notes all work with no
   signal and sync when you're back online. If another device used a code
   first, the home screen asks you to relabel the plate (S-2C → S-2D).

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
  `item_lineage`, `strain_tree`, `create_backups`, `contamination_trace`,
  and for offline phones `apply_items`, `apply_status`, `apply_event`.

### Tests

| Command | What it runs |
|---|---|
| `npm run check` | types, lint, unit tests (run before every push) |
| `npm run test:db` | 99 pgTAP database tests (needs Docker Desktop and `npx supabase start`) |
| `npm run test:e2e` | web build + Playwright screen tests against a mocked backend |
| `npm run test:integration` | the phone's sync and offline queue against a real local Supabase (needs `npx supabase start`) |
| `npm run test:e2e:real` | screen tests against a real local Supabase (needs `npx supabase start`) |

GitHub Actions runs all of them on every pull request, every push to `main` and
daily. See `docs/TESTING.md` for which layer a new test belongs in, and
`CONTRIBUTING.md` for the branch and PR workflow.

## Next (Milestone 2)

Offline-first: expo-sqlite on the phone with an outbox that syncs to Supabase,
so the app works with no signal in the grow space. `updated_at`, client-side
UUIDs, soft deletes and `src/domain/cultureCode.ts` are already in place for it.

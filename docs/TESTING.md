# Testing

Six layers. CI runs all of them on every pull request, every push to `main`, and daily.

| Layer | Command | Where tests live | What it protects |
|---|---|---|---|
| Types + lint | `npm run typecheck`, `npm run lint` | whole app | type errors, React hook mistakes |
| Unit | `npm test` | `src/**/__tests__/*.test.ts` | app logic: culture-code helpers, trace wording, offline sync and local queries (run on real SQLite via sql.js) |
| Database | `npm run test:db` (needs Docker: `npx supabase start` first) | `supabase/tests/database/*.test.sql` | culture codes, 20-character limit, backups, lineage order, tenant isolation (RLS) |
| Screens | `npm run test:e2e` | `e2e/*.spec.ts` | every screen's behaviour, against a mocked backend (fast, no setup) |
| Integration | `npm run test:integration` (needs `npx supabase start`) | `integration/*.int.test.ts` | the phone's sync and offline queue against the real Supabase API, server functions and security rules |
| Screens, real backend | `npm run test:e2e:real` (needs `npx supabase start`) | `e2e-real/*.spec.ts` | key screens with a real signed-in user, real data and permissions |

`npm run check` runs types, lint and unit tests together; use it before every push.

## Tests are required

Every pull request that changes app code (`src/`) or the database (`supabase/migrations/`) must also change tests. The **Tests included** check enforces this. For changes that truly need none (a refactor with no behaviour change, wording, config), add the `no-tests-needed` label and say why in the PR description.

In Claude Code, the `test-writer` agent writes tests for the current branch: ask "use the test-writer agent on this change".

## Which layer gets the test

- **A rule the database enforces** (codes, permissions, ordering from SQL) → pgTAP. The database is the source of truth.
- **App logic that doesn't need the network** → Jest.
- **What a person sees or taps** → Playwright.
- **A bug fix** → a test that fails before the fix, named after the bug, at the layer where the bug lived.

## Screen tests

`npm run test:e2e` builds the web app pointed at a fake Supabase URL, serves it, and runs Playwright with Supabase mocked in `e2e/fixtures.ts` (a small lab: strain Blue Oyster, origin TBG and its transfers). Tests can read `lab.rpcCalls` to check what the app sent.

First time on a new machine: `npx playwright install chromium`.

The mock only stands in for the network. Anything about what the database returns (codes, order, permissions) is tested in pgTAP, not here.

## Database tests

pgTAP files run inside a transaction and roll back, so they never leave data behind. Use the helpers at the top of each file (`tests.sign_in`, `tests.id`) and sign in as a test user before calling functions, so row-level security applies exactly as in the app.

## Integration and real-backend screen tests

These run against a throwaway local Supabase (CI starts one per run; locally: Docker Desktop, then `npx supabase start`). They create their own test users and labs, so they never touch your real project.

- **Integration** (`integration/`): each "phone" is a SQLite database running the app's real offline code (`src/offline/`), talking to the real API. Covers the first pull and history window, lineage parity with the server, offline saves sent in order, two phones conflicting over a code, refused changes, and lab isolation.
- **Real-backend screens** (`e2e-real/`): `global-setup.ts` seeds two labs, then the web app runs against them signed in as the first. Tests share that data and run in order.

Test users are signed in with tokens signed by the local stack's JWT secret (`integration/supabaseTest.ts`), so no emails are sent.

Not covered yet: the phone-only parts (expo-sqlite, network detection, the offline badge) on a real device. Planned: Maestro tests on an Android emulator (see the roadmap).

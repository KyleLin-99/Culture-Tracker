# Testing

Four layers. CI runs all of them on every pull request, every push to `main`, and daily.

| Layer | Command | Where tests live | What it protects |
|---|---|---|---|
| Types + lint | `npm run typecheck`, `npm run lint` | whole app | type errors, React hook mistakes |
| Unit | `npm test` | `src/**/__tests__/*.test.ts` | app logic, e.g. culture-code helpers |
| Database | `npm run test:db` (needs Docker: `npx supabase start` first) | `supabase/tests/database/*.test.sql` | culture codes, 20-character limit, backups, lineage order, tenant isolation (RLS) |
| Screens | `npm run test:e2e` | `e2e/*.spec.ts` | sign-in, home lookup, culture detail, transfer, batch backups |

`npm run check` runs types, lint and unit tests together; use it before every push.

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

# Culture Tracker: rules for Claude

@AGENTS.md

## Definition of done

A change is done when:
1. Its behaviour is covered by tests at the right layer (see `docs/TESTING.md`), including a failing-first test for every bug fix.
2. `npm run check` passes, plus `npm run test:e2e` for screen changes and `npm run test:db` for SQL changes.
3. Docs are updated if behaviour changed.

After implementing anything, use the `test-writer` agent (`.claude/agents/test-writer.md`) to add or update tests. CI's **Tests included** check fails any PR that changes `src/` or `supabase/migrations/` without changing tests.

## Before you change code

- Read `docs/TESTING.md`. Every change needs a test at the right layer; run `npm run check` before finishing.
- Database changes are a **new** migration in `supabase/migrations/` (timestamped name). Never edit a migration that has been pushed.
- Culture-code rules live in two places that must agree: the SQL trigger (`*_culture_codes.sql`) and `src/domain/cultureCode.ts`. Change both, with a pgTAP test and a Jest test.
- Every table keeps `account_id`, row-level security, and composite foreign keys with `account_id`. New RPC functions are `security invoker`, revoke from `anon`, grant to `authenticated`.
- Codes and lineage are permanent once written; don't add ways to edit them. The same goes for history entries: only notes can be edited or removed (`edit_note()`), and a trigger refuses any other change.
- Phones read from a local copy (`src/offline/`). A new read in `src/lib/api.ts` that phones use needs a local version in `src/offline/queries.ts`, with a test showing it answers like the server function. A new synced table or column goes in `src/offline/tables.ts` plus a new step in `schema.ts` (never edit an old step). A new kind of change phones can make offline needs an outbox op (`src/offline/outbox.ts`), an idempotent server function, and tests on both sides.

## When reviewing a pull request

Flag, in order of importance:
1. Anything that could let one account read or write another account's rows (missing RLS, `security definer` without a membership check, grants to `anon`).
2. Changes to culture-code behaviour without matching tests in both SQL and TypeScript.
3. Edits to existing migrations.
4. Missing tests for new behaviour.
5. Dates computed on the server with `current_date` where the client's local date should be passed (`todayLocal()`).

Keep comments short and specific; skip style nits that lint already covers.

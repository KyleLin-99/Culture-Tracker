# Culture Tracker: rules for Claude

@AGENTS.md

## Before you change code

- Read `docs/TESTING.md`. Every change needs a test at the right layer; run `npm run check` before finishing.
- Database changes are a **new** migration in `supabase/migrations/` (timestamped name). Never edit a migration that has been pushed.
- Culture-code rules live in two places that must agree: the SQL trigger (`*_culture_codes.sql`) and `src/domain/cultureCode.ts`. Change both, with a pgTAP test and a Jest test.
- Every table keeps `account_id`, row-level security, and composite foreign keys with `account_id`. New RPC functions are `security invoker`, revoke from `anon`, grant to `authenticated`.
- Codes and lineage are permanent once written; don't add ways to edit them.

## When reviewing a pull request

Flag, in order of importance:
1. Anything that could let one account read or write another account's rows (missing RLS, `security definer` without a membership check, grants to `anon`).
2. Changes to culture-code behaviour without matching tests in both SQL and TypeScript.
3. Edits to existing migrations.
4. Missing tests for new behaviour.
5. Dates computed on the server with `current_date` where the client's local date should be passed (`todayLocal()`).

Keep comments short and specific; skip style nits that lint already covers.

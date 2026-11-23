# Contributing

## Workflow

1. Branch from `main`: `feat/short-name` or `fix/short-name`.
2. Make the change with its tests (see `docs/TESTING.md`).
3. Run `npm run check` (types, lint, unit tests). If you touched SQL and have Docker running: `npx supabase start` then `npm run test:db`.
4. Push and open a pull request. Fill in the checklist.
5. CI runs (types, lint, unit, database, screens, tests included). Claude reviews the diff and comments. No tests needed? Add the `no-tests-needed` label and say why.
6. Squash-merge when CI is green. Delete the branch.
7. If the PR added a migration: `npx supabase db push --remote`.

## Commit messages

Short, imperative, says what changed for the lab: `Add batch backups`, `Fix lineage order under parents`.

## Database changes

- New migration file per change: `supabase/migrations/YYYYMMDDHHMMSS_what_it_does.sql`.
- Never edit a migration after it's pushed; write a new one that alters it.
- Use `create or replace function` to change a function; keep its signature or drop and recreate it with grants.

## Releases (later)

Mobile builds and web deploys will run from a green `main` only, as extra jobs after CI.

## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] Tests added or updated (pgTAP for database rules, Jest for app logic, Playwright for screens)
- [ ] Schema changes are a **new** migration file, never an edit to an old one
- [ ] Culture-code rule changes are made in both the SQL trigger and `src/domain/cultureCode.ts`
- [ ] `npm run check` passes locally
- [ ] Docs updated if behaviour changed (README, `docs/`)
- [ ] After merge: `npx supabase db push --remote` if there's a new migration

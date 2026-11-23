// Fails a pull request that changes app code or the database without touching
// any tests. Run by .github/workflows/tests-included.yml.
//
// Override: add the label "no-tests-needed" to the PR (for refactors, copy
// changes, config) and say why in the description.
//
// Usage: node scripts/check-tests-included.mjs <base-ref>
import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'origin/main';
const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const isTest = (f) =>
  /(^|\/)__tests__\//.test(f) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) ||
  f.startsWith('e2e/') ||
  f.startsWith('supabase/tests/');

const migrations = changed.filter((f) => f.startsWith('supabase/migrations/'));
const appCode = changed.filter((f) => /^src\/.*\.[cm]?[jt]sx?$/.test(f) && !isTest(f));
const tests = changed.filter(isTest);
const dbTests = changed.filter((f) => f.startsWith('supabase/tests/'));

const problems = [];
if (migrations.length && !dbTests.length) {
  problems.push(
    `Database migrations changed with no pgTAP test changes:\n  ${migrations.join('\n  ')}\n` +
      '  Add or update a test in supabase/tests/database/.',
  );
}
if (appCode.length && !tests.length) {
  problems.push(
    `App code changed with no test changes:\n  ${appCode.join('\n  ')}\n` +
      '  Add a Jest test (src/**/__tests__/) for logic or a Playwright test (e2e/) for screens.',
  );
}

if (problems.length) {
  console.error(problems.join('\n\n'));
  console.error('\nSee docs/TESTING.md for which layer a test belongs in.');
  console.error('If this change truly needs no tests, add the "no-tests-needed" label and explain why in the PR.');
  process.exit(1);
}

console.log(
  changed.length
    ? `OK: ${tests.length} test file(s) changed alongside ${appCode.length + migrations.length} code/migration file(s).`
    : 'OK: no changes.',
);

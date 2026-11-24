// The web app against a real local Supabase. Tests run in order and share the
// seeded labs (e2e-real/global-setup.ts).
import { expect, test } from './fixtures';

test('the contamination trace ranks the bad sterilization run from real data', async ({ signedIn: page }) => {
  await page.goto('/trace');
  const card = page.getByText('Sterilization run SR-002');
  await expect(card).toBeVisible();
  await expect(page.getByText(/^5 of 6 with SR-002 contaminated \(83%\) · 0 of \d+ without \(0%\)$/)).toBeVisible();
  await expect(page.getByText('Strong lead').first()).toBeVisible();
  await expect(page.getByText('Sterilization run SR-001')).toBeHidden(); // no contamination on it
});

test('home shows the lab and finds a culture by code', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByText("Kyle's Lab · KL")).toBeVisible();
  await page.getByPlaceholder('Culture code').fill(' s-2a ');
  await expect(page.getByText('S-2A', { exact: true })).toBeVisible();
});

test('lineage comes back from the server in tree order', async ({ signedIn: page, seed }) => {
  await page.goto(`/items/${seed.ids['S-2']}`);
  const rows = page.locator('[data-testid^="tree-row-"]');
  await expect(rows).toHaveCount(4);
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('tree-row-'.length)));
  expect(order).toEqual(['S', 'S-2', 'S-2A', 'S-2B']);
});

test('a transfer creates real cultures with the next codes', async ({ signedIn: page, seed, db }) => {
  await page.goto(`/items/${seed.ids['S-3']}/transfer`);
  await page.getByLabel('More').click();
  await page.getByRole('button', { name: 'Create 2' }).click();
  await expect(page.getByText('S-3B', { exact: true })).toBeVisible();
  await expect(page.getByText('S-3C', { exact: true })).toBeVisible();

  const saved = await db.query("select code from items where parent_id = $1 order by code", [seed.ids['S-3']]);
  expect(saved.rows.map((r) => r.code)).toEqual(['S-3A', 'S-3B', 'S-3C']);
});

test('backups are numbered by the database', async ({ signedIn: page, seed }) => {
  await page.goto(`/items/${seed.ids['S-2A']}`);
  await page.getByRole('button', { name: 'Make backups' }).click();
  await page.getByLabel('More').click();
  await page.getByRole('button', { name: 'Create 2 backups' }).click();
  await expect(page.getByText('S-2A(1)', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('S-2A(2)', { exact: true }).first()).toBeVisible();
});

test('a sterilization run and batch get their codes from the database', async ({ signedIn: page }) => {
  await page.goto('/batches');
  await page.getByRole('button', { name: 'Log run' }).click();
  await expect(page.getByText('Logged SR-003. Write the code on the jar or sleeve.')).toBeVisible();
  await page.getByRole('button', { name: 'Log batch' }).click();
  await expect(page.getByText('Logged MB-003. Write the code on the jar or sleeve.')).toBeVisible();
});

test('marking a plate relabeled saves to the server', async ({ signedIn: page, seed, db }) => {
  await page.goto('/');
  await expect(page.getByText('S-2Q → S-2B')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Relabel these plates')).toBeHidden();
  const r = await db.query('select resolved_at from relabels where account_id = $1', [seed.accountId]);
  expect(r.rows[0].resolved_at).not.toBeNull();
});

test("another lab's cultures never show up", async ({ signedIn: page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Culture code').fill('ZZ');
  await expect(page.getByText('No culture with that code.')).toBeVisible();
});

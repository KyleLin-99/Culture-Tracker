import { expect, test } from './fixtures';

test('exporting the lab downloads a spreadsheet of cultures', async ({ signedIn: page }) => {
  await page.goto('/account');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export cultures (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^.+-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(text.split('\r\n')[0]).toBe('code,strain,kind,medium,status,parent,generation,made_on,initials,location,notes');
  expect(text).toContain('TBG-2A,Blue Oyster,transfer,agar,active,TBG-2,2,');
  await expect(page.getByTestId('export-done')).toBeVisible();
});

test('exporting everything downloads JSON', async ({ signedIn: page }) => {
  await page.goto('/account');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export everything (JSON)' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

test('deleting the account asks twice, then offers a way back', async ({ signedIn: page, lab }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  expect(lab.rpcCalls.filter((c) => c.fn === 'request_account_deletion')).toHaveLength(0);
  await page.getByRole('button', { name: 'Yes, delete my account' }).click();
  await expect(page.getByTestId('deletion-date')).toHaveText('It will be removed on 2026-12-24.');

  await page.getByRole('button', { name: 'Keep my account' }).click();
  await expect(page.getByTestId('current-lab')).toBeVisible();
  expect(lab.admin.deletion).toBeNull();
});

test('signing in with a deletion pending shows only the keep-or-delete screen', async ({ signedIn: page, lab }) => {
  lab.admin.deletion = { purge_after: '2026-12-24T00:00:00Z' };
  await page.goto('/');
  await expect(page.getByTestId('deletion-date')).toBeVisible();
  await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0);
});

test('the only owner of a shared lab is told to hand it over first', async ({ signedIn: page, lab }) => {
  lab.admin.deletionBlocked = true;
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  await page.getByRole('button', { name: 'Yes, delete my account' }).click();
  await expect(page.getByText('Make someone else an owner of "Test Lab" first', { exact: false })).toBeVisible();
  expect(lab.admin.deletion).toBeNull();
});

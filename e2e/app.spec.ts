import { expect, test } from './fixtures';

test('signed-out users see the sign-in screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Culture Tracker')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
});

test('sign-in asks for the emailed code', async ({ page, lab }) => {
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('kyle@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('We sent a sign-in code to kyle@example.com.')).toBeVisible();
  expect(lab.rpcCalls).toHaveLength(0);
});

test('home lists recent cultures and finds one by code', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByText('Recent')).toBeVisible();
  await expect(page.getByText('TBG-3A', { exact: true })).toBeVisible();

  await page.getByPlaceholder('Culture code').fill(' tbg-3 ');
  await expect(page.getByText('TBG-3B', { exact: true })).toBeVisible();
  await expect(page.getByText('TBG-2A', { exact: true })).toBeHidden();
});

test('lineage lists each child directly under its parent', async ({ signedIn: page }) => {
  // Regression: children used to be listed level by level, so TBG-3A showed
  // after TBG-2A instead of under TBG-3.
  await page.goto('/items/o-tbg');
  const rows = page.locator('[data-testid^="tree-row-"]');
  await expect(rows).toHaveCount(7);
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('tree-row-'.length)));
  expect(order).toEqual(['TBG', 'TBG-1', 'TBG-2', 'TBG-2A', 'TBG-3', 'TBG-3A', 'TBG-3B']);
});

test('transfer creates the cultures and shows the labels to write', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-3/transfer');
  await page.getByLabel('More').click();
  await page.getByText('Liquid culture').click();
  await page.getByRole('button', { name: 'Create 2' }).click();

  await expect(page.getByText('TBG-3C', { exact: true })).toBeVisible();
  await expect(page.getByText('TBG-3D', { exact: true })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'create_transfers')?.body).toMatchObject({
    p_parent_id: 't-3',
    p_count: 2,
    p_medium: 'lc',
  });
});

test('backups can be made in a batch', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-2a');
  await page.getByRole('button', { name: 'Make backups' }).click();
  await page.getByLabel('More').click();
  await page.getByLabel('More').click();
  await page.getByRole('button', { name: 'Create 3 backups' }).click();

  await expect(page.getByText('Write these labels:')).toBeVisible();
  // Each new code shows on the label list and in the refreshed lineage below it.
  for (const code of ['TBG-2A(1)', 'TBG-2A(2)', 'TBG-2A(3)']) {
    await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId(`tree-row-${code}`)).toBeVisible();
  }
  expect(lab.rpcCalls.find((c) => c.fn === 'create_backups')?.body).toMatchObject({
    p_parent_id: 't-2a',
    p_count: 3,
    p_medium: 'slant',
  });
});

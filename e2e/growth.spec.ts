import { expect, test } from './fixtures';

test('a culture growing much slower than its ancestors is flagged', async ({ signedIn: page }) => {
  await page.goto('/items/t-3a');
  // Two checks: 8 mm then 12 mm on days 4 and 6 → 2 mm/day; 20% then 30% → 5 %/day.
  await expect(page.getByTestId('growth-rate')).toContainText('2 mm/day · 5 %/day');
  await expect(page.getByTestId('growth-rate')).toContainText('from 2 checks');

  // Ancestors TBG (4 mm/day) and TBG-3 (4.25) average 4.1.
  const warning = page.getByTestId('slow-warning');
  await expect(warning).toContainText('Growing 52% slower than its ancestors (2 mm/day vs 4.1 mm/day)');
  const rows = page.getByTestId('vigor-row');
  await expect(rows).toHaveCount(3);
  expect(await rows.allInnerTexts()).toEqual([
    expect.stringMatching(/^TBG\s+4$/),
    expect.stringMatching(/^TBG-3\s+4\.3$/),
    expect.stringMatching(/^TBG-3A\s+2$/),
  ]);
});

test('a culture keeping pace with its ancestors is not flagged', async ({ signedIn: page }) => {
  await page.goto('/items/t-3');
  await expect(page.getByTestId('growth-rate')).toContainText('4.3 mm/day');
  await expect(page.getByTestId('vigor-row')).toHaveCount(2);
  await expect(page.getByTestId('slow-warning')).toHaveCount(0);
});

test('log a growth check', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-2');
  await expect(page.getByText('No checks yet.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Log growth check' }).click();
  await page.getByLabel('Colonized (%)').fill('40');
  await page.getByLabel('Radius (mm)').fill('18');
  await page.getByLabel('Date').fill('2026-11-27');
  await page.getByLabel('Note (optional)').fill('Even, rhizomorphic');
  await page.getByRole('button', { name: 'Save check' }).click();

  await expect(page.getByTestId('growth-rate')).toContainText('4.5 mm/day · 10 %/day');
  await expect(page.getByTestId('check-row')).toContainText('11/27/26 · 40% · 18 mm · Even, rhizomorphic');
  expect(lab.rpcCalls.find((c) => c.fn === 'apply_check')?.body).toMatchObject({
    p_item_id: 't-2',
    p_checked_on: '2026-11-27',
    p_percent: 40,
    p_radius_mm: 18,
    p_note: 'Even, rhizomorphic',
  });
});

test('a growth check needs a readable measurement', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-2');
  await page.getByRole('button', { name: 'Log growth check' }).click();
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.getByText('Enter percent colonized, radius, or both.')).toBeVisible();
  await page.getByLabel('Colonized (%)').fill('150');
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.getByText('Percent is between 0 and 100.')).toBeVisible();
  expect(lab.rpcCalls.some((c) => c.fn === 'apply_check')).toBe(false);
});

test('remove a check logged by mistake', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-3');
  await page.getByRole('link', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Keep' }).click();
  expect(lab.rpcCalls.some((c) => c.fn === 'remove_check')).toBe(false);

  await page.getByRole('link', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove check' }).click();
  await expect(page.getByText('No checks yet.', { exact: false })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'remove_check')?.body).toEqual({ p_id: 'ck-3' });
});

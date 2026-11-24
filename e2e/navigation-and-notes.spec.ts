import { expect, test } from './fixtures';

test('a culture opened from a link still has a way home', async ({ signedIn: page }) => {
  // Opened directly (a refresh, a link): there's no history to go back through.
  await page.goto('/items/t-2a');
  await expect(page.getByText('TBG-2A', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByText('Recent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Home' })).toBeHidden(); // not on home itself
});

test('a culture links up to its strain, and the strain to all strains', async ({ signedIn: page }) => {
  await page.goto('/');
  // Dig a few cultures deep through the lineage.
  await page.getByText('TBG-2A', { exact: true }).first().click();
  await page.locator('[data-testid="tree-row-TBG"]').click();
  await page.locator('[data-testid="tree-row-TBG-3"]').click();

  await page.getByRole('link', { name: '‹ Blue Oyster' }).click();
  await expect(page.getByText('Family tree')).toBeVisible();

  await page.getByRole('link', { name: '‹ All strains' }).click();
  await expect(page).toHaveURL(/\/strains$/);
  // Web keeps earlier screens in the page (hidden), so look only at what's showing.
  await expect(page.getByText('Blue Oyster', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('a note can be edited', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-2');
  await expect(page.getByText('Slow growth')).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Edit note').fill('Slow at first, then fast');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Slow at first, then fast')).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'edit_note')?.body).toEqual({
    p_id: 'ev-note',
    p_note: 'Slow at first, then fast',
    p_delete: false,
  });
});

test('a note can be removed after confirming', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-2');
  await page.getByRole('link', { name: 'Remove' }).click();

  // Changing your mind keeps it.
  await page.getByRole('button', { name: 'Keep' }).click();
  await expect(page.getByText('Slow growth')).toBeVisible();
  expect(lab.rpcCalls.some((c) => c.fn === 'edit_note')).toBe(false);

  await page.getByRole('link', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove note' }).click();
  await expect(page.getByText('Slow growth')).toBeHidden();
  expect(lab.rpcCalls.find((c) => c.fn === 'edit_note')?.body).toMatchObject({ p_id: 'ev-note', p_delete: true });
});

test('transfers and other automatic history have no edit or remove', async ({ signedIn: page }) => {
  await page.goto('/items/t-2');
  await expect(page.getByText('1 × agar: TBG-2A')).toBeVisible();
  // One note, so exactly one Edit and one Remove.
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Remove' })).toHaveCount(1);
});

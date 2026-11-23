import { expect, test } from './fixtures';

// Offline saving itself runs on phones only (tested in src/offline/__tests__);
// the relabel list it produces also shows on the web dashboard.

test('plates renumbered after a code conflict are listed for relabeling', async ({ signedIn: page, lab }) => {
  lab.relabels.push({ id: 'rl-1', entity_id: 't-3a', old_code: 'TBG-3A', new_code: 'TBG-3C', created_at: '2026-11-23T12:00:00Z' });
  await page.goto('/');
  await expect(page.getByText('Relabel these plates')).toBeVisible();
  await expect(page.getByText('TBG-3A → TBG-3C')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Relabel these plates')).toBeHidden();
  expect(lab.inserts.at(-1)).toMatchObject({ table: 'relabels:update', body: { id: 'rl-1' } });
});

test('nothing extra shows on home when there is nothing to relabel', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByText('Recent')).toBeVisible();
  await expect(page.getByText('Relabel these plates')).toBeHidden();
  await expect(page.getByText("Couldn't save")).toBeHidden();
});

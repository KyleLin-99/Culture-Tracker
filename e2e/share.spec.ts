import { expect, test } from './fixtures';

test('share a strain lineage link, then turn it off', async ({ signedIn: page, lab }) => {
  await page.goto('/strains');
  await page.getByText('Blue Oyster').first().click();
  const share = page.getByTestId('share-lineage');
  await expect(share).toContainText('No notes or initials. Works for 30 days.');

  await share.getByRole('button', { name: 'Make a link' }).click();
  await expect(page.getByTestId('share-url')).toHaveText(/\/shared\/tok1abcdefghjkmnpqrstuvw$/);
  expect(lab.rpcCalls.find((c) => c.fn === 'create_share_link')?.body).toMatchObject({ p_days: 30 });
  await expect(page.getByTestId('share-link-row')).toHaveCount(1);

  await share.getByRole('link', { name: 'Turn off' }).click();
  await expect(page.getByTestId('share-link-row')).toHaveCount(0);
});

test('anyone with the link sees the tree, signed out, without initials', async ({ page, lab }) => {
  lab.shareLinks.push({ id: 'sl-1', token: 'tok1abcdefghjkmnpqrstuvw', created_at: '2026-11-24T00:00:00Z', expires_at: '2026-12-24T00:00:00Z', revoked_at: null });
  await page.goto('/shared/tok1abcdefghjkmnpqrstuvw');
  await expect(page.getByText('Pleurotus ostreatus')).toBeVisible();
  await expect(page.getByTestId('tree-row-TBG')).toBeVisible();
  await expect(page.getByTestId('tree-row-TBG-3A')).toBeVisible();
  await expect(page.getByText('KL', { exact: false })).toHaveCount(0); // no initials
  await page.getByTestId('tree-row-TBG-2').click(); // rows don't open anything
  await expect(page).toHaveURL(/\/shared\/tok1/);
  await expect(page.getByText('Read-only; this link works until', { exact: false })).toBeVisible();
});

test('a turned-off or wrong link says so', async ({ page }) => {
  await page.goto('/shared/nope');
  await expect(page.getByText('This link has expired or been turned off. Ask for a new one.')).toBeVisible();
});

test('viewers see existing links but cannot make or turn them off', async ({ signedIn: page, lab }) => {
  lab.members.find((m) => m.role === 'owner')!.role = 'viewer';
  await page.goto('/strains');
  await page.getByText('Blue Oyster').first().click();
  await expect(page.getByText('Family tree', { exact: true })).toBeVisible();
  await expect(page.getByTestId('share-lineage')).toHaveCount(0); // nothing shared yet: no section

  lab.shareLinks.push({ id: 'sl-1', token: 'x', created_at: '2026-11-24T00:00:00Z', expires_at: '2026-12-24T00:00:00Z', revoked_at: null });
  await page.reload();
  await expect(page.getByTestId('share-link-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Make a link' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Turn off' })).toHaveCount(0);
});

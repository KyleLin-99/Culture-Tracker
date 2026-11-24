import { ACCOUNT_ID, expect, type Lab, STRAIN_ID, test } from './fixtures';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function culture(lab: Lab, id: string, code: string, kind: string, parent: string, o: Record<string, unknown> = {}) {
  lab.items.push({
    id, account_id: ACCOUNT_ID, strain_id: STRAIN_ID, parent_id: parent, kind, medium: 'slant', origin_prefix: null,
    origin_number: null, position: null, backup_number: kind === 'backup' ? 1 : null, code, generation: 1, status: 'active',
    location: null, made_on: daysAgo(200), initials: 'KL', notes: null, created_at: `${daysAgo(200)}T12:00:00Z`,
    strains: { name: 'Blue Oyster' }, media_batch_id: null, media_batches: null, refresh_of: null, ...o,
  });
}

test('refresh a due backup from its active parent; it stops being due', async ({ signedIn: page, lab }) => {
  culture(lab, 'bk-1', 'TBG-2(1)', 'backup', 't-2');
  await page.goto('/');
  await expect(page.getByTestId('backups-due')).toContainText('TBG-2(1)');

  await page.getByTestId('backups-due').getByText('TBG-2(1)').click();
  await page.getByRole('button', { name: 'Refresh backup' }).click();
  await expect(page.getByTestId('refresh-plan')).toHaveText('Makes a new backup from TBG-2, which is still active (same generation).');
  await page.getByRole('button', { name: 'Refresh now' }).click();

  await expect(page.getByText('Write this label:')).toBeVisible();
  await expect(page.getByTestId('refresh-section')).toContainText('TBG-2(2)');
  expect(lab.rpcCalls.find((c) => c.fn === 'refresh_backup')?.body).toEqual({ p_backup_id: 'bk-1', p_made_on: daysAgo(0) });
  await expect(page.getByRole('link', { name: 'TBG-2(2) ›', exact: true })).toBeVisible();
  await expect(page.getByText('Keep this backup until TBG-2(2) has a growth check', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByText('Recent')).toBeVisible();
  await expect(page.getByTestId('backups-due')).toHaveCount(0);
});

test('when the parent is used up, the refresh grows from the backup itself', async ({ signedIn: page, lab }) => {
  lab.items.find((i) => i.id === 't-2')!.status = 'used';
  culture(lab, 'bk-1', 'TBG-2(1)', 'backup', 't-2');
  await page.goto('/items/bk-1');
  await page.getByRole('button', { name: 'Refresh backup' }).click();
  await expect(page.getByTestId('refresh-plan')).toHaveText('TBG-2 is no longer active, so this grows a new culture from TBG-2(1).');
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(page.getByTestId('refresh-section')).toContainText('TBG-2(1)-1');
});

test('retire the old backup once its refresh has a growth check', async ({ signedIn: page, lab }) => {
  culture(lab, 'bk-1', 'TBG-2(1)', 'backup', 't-2');
  culture(lab, 'bk-2', 'TBG-2(2)', 'backup', 't-2', { made_on: daysAgo(5), refresh_of: 'bk-1' });
  lab.checks.push({
    id: 'ck-r', account_id: ACCOUNT_ID, item_id: 'bk-2', checked_on: daysAgo(1), percent: 30, radius_mm: null, note: null,
    source: 'manual', created_at: `${daysAgo(1)}T12:00:00Z`, deleted_at: null,
  });
  await page.goto('/items/bk-1');
  await expect(page.getByRole('button', { name: 'Refresh backup' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retire this backup' }).click();
  expect(lab.rpcCalls.find((c) => c.fn === 'set_item_status')?.body).toMatchObject({ p_item_id: 'bk-1', p_status: 'used' });
});

test('the new culture links back to the backup it refreshes', async ({ signedIn: page, lab }) => {
  culture(lab, 'bk-1', 'TBG-2(1)', 'backup', 't-2');
  culture(lab, 'bk-2', 'TBG-2(2)', 'backup', 't-2', { refresh_of: 'bk-1' });
  await page.goto('/items/bk-2');
  await page.getByRole('link', { name: 'Refresh of TBG-2(1) ›' }).click();
  await expect(page).toHaveURL(/\/items\/bk-1$/);
});

test('if the refresh contaminated, the backup can be refreshed again', async ({ signedIn: page, lab }) => {
  culture(lab, 'bk-1', 'TBG-2(1)', 'backup', 't-2');
  culture(lab, 'bk-2', 'TBG-2(2)', 'backup', 't-2', { refresh_of: 'bk-1', status: 'contaminated' });
  await page.goto('/items/bk-1');
  await expect(page.getByText('The last refresh (TBG-2(2)) was contaminated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh backup' })).toBeVisible();
});

import { ACCOUNT_ID, expect, type Lab, STRAIN_ID, test } from './fixtures';

/** The local date n days ago, as the app computes today (todayLocal). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addBackup(lab: Lab, code: string, medium: string, madeDaysAgo: number, status = 'active') {
  lab.items.push({
    id: `bk-${code}`, account_id: ACCOUNT_ID, strain_id: STRAIN_ID, parent_id: 't-2', kind: 'backup', medium,
    origin_prefix: null, origin_number: null, position: null, backup_number: 1, code, generation: 1, status,
    location: null, made_on: daysAgo(madeDaysAgo), initials: 'KL', notes: null, created_at: `${daysAgo(madeDaysAgo)}T12:00:00Z`,
    strains: { name: 'Blue Oyster' }, media_batch_id: null, media_batches: null,
  });
}

test('home lists backups past or near their refresh age, most urgent first', async ({ signedIn: page, lab }) => {
  addBackup(lab, 'TBG-2(1)', 'slant', 200); // slant: 180 days → 20 days overdue
  addBackup(lab, 'TBG-2(2)', 'lc', 115); // LC: 120 days → due in 5 days
  addBackup(lab, 'TBG-2(3)', 'agar', 10); // agar: 60 days → not yet
  addBackup(lab, 'TBG-2(4)', 'slant', 400, 'used'); // retired: never listed
  await page.goto('/');

  const due = page.getByTestId('backups-due');
  await expect(due).toBeVisible();
  expect(await page.getByTestId('due-text').allInnerTexts()).toEqual([
    expect.stringMatching(/^20 days overdue · Slant made .* · Blue Oyster$/),
    expect.stringMatching(/^due in 5 days · Liquid culture made /),
  ]);
  await expect(due).not.toContainText('TBG-2(3)');

  await due.getByText('TBG-2(1)').click();
  await expect(page).toHaveURL(/\/items\/bk-TBG-2\(1\)$/);
});

test('no section when nothing is due', async ({ signedIn: page, lab }) => {
  addBackup(lab, 'TBG-2(1)', 'slant', 30);
  await page.goto('/');
  await expect(page.getByText('Recent')).toBeVisible();
  await expect(page.getByTestId('backups-due')).toHaveCount(0);
});

test('refresh ages are set in Lab settings and change what is due', async ({ signedIn: page, lab }) => {
  addBackup(lab, 'TBG-2(1)', 'agar', 40); // default 60 days: not due
  await page.goto('/');
  await expect(page.getByTestId('backups-due')).toHaveCount(0);

  await page.getByRole('button', { name: 'Lab settings' }).click();
  await expect(page.getByLabel('Agar (days)')).toHaveValue('60');
  await page.getByLabel('Agar (days)').fill('30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'set_backup_refresh')?.body).toEqual({
    p_account_id: ACCOUNT_ID,
    p_days: { slant: 180, lc: 120, agar: 30, other: 180 },
  });

  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByTestId('due-text')).toHaveText(/^10 days overdue · Agar/);
});

test('refresh ages must be whole days from 1', async ({ signedIn: page, lab }) => {
  await page.goto('/settings');
  await page.getByLabel('Slant (days)').fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Refresh ages are whole days from 1 to 3650.')).toBeVisible();
  expect(lab.rpcCalls.some((c) => c.fn === 'set_backup_refresh')).toBe(false);
});

import { expect, test } from './fixtures';

const user = (id: string, email: string, extra = {}) => ({
  user_id: id, email, tier: 'standard', early_access: false, is_admin: false,
  created_at: '2026-11-01T00:00:00Z', last_sign_in_at: null, labs_owned: 1, labs_joined: 0, ...extra,
});

test('regular people see no back-office entry', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'About' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back office' })).toHaveCount(0);
});

test('an admin changes a plan and sees it in the audit log', async ({ signedIn: page, lab }) => {
  lab.admin.isAdmin = true;
  lab.admin.users = [user('u1', 'kyle@example.com', { is_admin: true, tier: 'special' }), user('u2', 'friend@example.com')];
  await page.goto('/');
  await page.getByRole('button', { name: 'Back office' }).click();
  await expect(page.getByTestId('admin-users')).toContainText('2 of 25 people');

  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByLabel('Search by email').fill('friend');
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await page.getByTestId('user-row').click();
  await page.getByText('Paid 1', { exact: true }).click();
  expect(lab.rpcCalls.find((c) => c.fn === 'admin_set_tier')?.body).toEqual({ p_user_id: 'u2', p_tier: 'paid1' });
  await expect(page.getByTestId('user-row')).toContainText('Paid 1');

  await page.goBack();
  await page.getByRole('button', { name: 'Audit log' }).click();
  await expect(page.getByTestId('audit-row')).toContainText('set_tier · friend@example.com');
});

test('an admin approves someone from the waitlist', async ({ signedIn: page, lab }) => {
  lab.admin.isAdmin = true;
  lab.admin.waitlist = [{ id: 'w1', email: 'wait@example.com', created_at: '2026-11-20T00:00:00Z', approved_at: null }];
  await page.goto('/admin/waitlist');
  await page.getByRole('button', { name: 'Approve wait@example.com' }).click();
  await expect(page.getByTestId('waitlist-row')).toContainText('approved');
  expect(lab.rpcCalls.find((c) => c.fn === 'admin_approve_waitlist')?.body).toEqual({ p_id: 'w1' });
});

test('an admin closes sign-ups and turns a flag on for early access', async ({ signedIn: page, lab }) => {
  lab.admin.isAdmin = true;
  lab.admin.flags = [{ key: 'photo_timeline', enabled: false, early_access_only: true, description: '' }];
  await page.goto('/admin');
  await page.getByRole('button', { name: /New sign-ups are open/ }).click();
  await expect(page.getByRole('button', { name: /New sign-ups are closed/ })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'admin_set_setting')?.body).toEqual({ p_key: 'signups_open', p_value: false });

  await page.getByRole('button', { name: 'Early access' }).click();
  await expect(page.getByTestId('flag-row')).toHaveText('photo_timeline · early access');
});

test('a non-admin who opens the back office is refused, with no data', async ({ signedIn: page }) => {
  await page.goto('/admin');
  await expect(page.getByText("Only the app's administrators can do this")).toBeVisible();
  await expect(page.getByTestId('admin-users')).toHaveCount(0);
});

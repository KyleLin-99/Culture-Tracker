import { ACCOUNT_ID, expect, test } from './fixtures';

test('the owner sees who is in the lab, invites someone, and can cancel the invite', async ({ signedIn: page, lab }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByTestId('member-row')).toHaveCount(2);
  expect(await page.getByTestId('member-row').allInnerTexts()).toEqual(['KL · Owner · you', 'JD · Tech']);

  await page.getByText('Viewer', { exact: true }).click();
  await expect(page.getByText('Sees everything, changes nothing.')).toBeVisible();
  await page.getByRole('button', { name: 'Make invite code' }).click();
  await expect(page.getByTestId('invite-code')).toHaveText('K7QD-M3XP');
  expect(lab.rpcCalls.find((c) => c.fn === 'invite_member')?.body).toEqual({ p_account_id: ACCOUNT_ID, p_role: 'viewer' });
  await expect(page.getByTestId('invite-row')).toContainText('Viewer · expires');

  await page.getByRole('link', { name: 'Cancel invite' }).click();
  await expect(page.getByTestId('invite-row')).toHaveCount(0);
});

test("the owner changes someone's role and removes them", async ({ signedIn: page, lab }) => {
  await page.goto('/people');
  const jd = page.getByTestId('member-row').filter({ hasText: 'JD' }).locator('..');
  await page.getByRole('link', { name: 'Change role' }).nth(1).click();
  await jd.getByText('Viewer', { exact: true }).click();
  await expect(page.getByTestId('member-row').filter({ hasText: 'JD' })).toHaveText('JD · Viewer');
  expect(lab.rpcCalls.find((c) => c.fn === 'set_member_role')?.body).toMatchObject({ p_role: 'viewer' });

  await page.getByRole('link', { name: 'Remove' }).click();
  await expect(page.getByText('Remove JD? What they recorded stays, with their initials.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByTestId('member-row')).toHaveCount(1);
});

test('join another lab with a code, then switch between labs', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByTestId('current-lab')).toHaveText("Kyle's Lab · KL · Owner");
  await page.getByRole('button', { name: 'Labs' }).click();

  await page.getByLabel('Invite code').fill('nope-nope');
  await page.getByLabel('Your initials in that lab').fill('kl');
  await page.getByRole('button', { name: 'Join lab' }).click();
  await expect(page.getByText("That code isn't valid.", { exact: false })).toBeVisible();

  await page.getByLabel('Invite code').fill('join-2lab');
  await page.getByRole('button', { name: 'Join lab' }).click();
  await expect(page.getByTestId('current-lab')).toHaveText('Friend Lab · KL · Viewer');
  await expect(page.getByRole('button', { name: 'Lab settings' })).toHaveCount(0); // owners only

  await page.getByRole('button', { name: 'Switch lab' }).click();
  await expect(page.getByTestId('lab-row').filter({ visible: true })).toHaveCount(2);
  expect(await page.getByTestId('lab-row').filter({ visible: true }).allInnerTexts()).toEqual([
    'Viewer · KL · working in this lab',
    'Owner · KL · tap to switch',
  ]);
  await page.getByText("Kyle's Lab", { exact: true }).filter({ visible: true }).click();
  await expect(page.getByTestId('current-lab')).toHaveText("Kyle's Lab · KL · Owner");
  await expect(page.getByRole('button', { name: 'Lab settings' })).toBeVisible();
});

test('someone new can join a lab instead of creating one', async ({ signedIn: page, lab }) => {
  lab.members = [];
  await page.goto('/');
  await expect(page.getByText('Or join a lab')).toBeVisible();
  await page.getByLabel('Invite code').fill('JOIN-2LAB');
  await page.getByLabel('Your initials in that lab').fill('AB');
  await page.getByRole('button', { name: 'Join lab' }).click();
  await expect(page.getByTestId('current-lab')).toHaveText('Friend Lab · AB · Viewer');
});

test('anyone can leave a lab they were invited to', async ({ signedIn: page, lab }) => {
  lab.members.find((m) => m.role === 'owner')!.role = 'tech';
  await page.goto('/people');
  await expect(page.getByRole('link', { name: 'Change role' })).toHaveCount(0); // not an owner
  await expect(page.getByRole('link', { name: 'Remove' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Leave' }).click();
  await page.getByRole('button', { name: 'Leave lab' }).click();
  expect(lab.rpcCalls.find((c) => c.fn === 'remove_member')?.body).toMatchObject({ p_account_id: ACCOUNT_ID });
});

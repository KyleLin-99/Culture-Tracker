// Bug: someone who belongs to two labs saw both labs' strains (and other lists)
// after switching labs. Row-level security allows every lab you belong to, and the
// list reads never named the current lab. The mock below answers like RLS: all of
// the user's labs unless the request filters by account_id.
import { ACCOUNT_ID, expect, joinSecondLab, OTHER_LAB_ID, test } from './fixtures';

test('the strains list shows only the lab you are working in, before and after switching', async ({ signedIn: page, lab }) => {
  joinSecondLab(lab);

  // Friend Lab sorts first, so it opens first.
  const firstLoad = page.waitForRequest((r) => r.url().includes('/rest/v1/strains') && r.method() === 'GET');
  await page.goto('/strains');
  expect(new URL((await firstLoad).url()).searchParams.get('account_id')).toBe(`eq.${OTHER_LAB_ID}`);
  await expect(page.getByText('Friend Reishi', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Blue Oyster', { exact: true }).filter({ visible: true })).toHaveCount(0);

  // Switch inside the app (no reload), as the person did.
  await page.getByRole('button', { name: 'Home' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Switch lab' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/labs$/);
  await page.getByText("Kyle's Lab", { exact: true }).filter({ visible: true }).click();
  await expect(page.getByTestId('current-lab').filter({ visible: true })).toHaveText("Kyle's Lab · KL · Owner");

  const afterSwitch = page.waitForRequest(
    (r) => r.url().includes('/rest/v1/strains') && r.url().includes(`account_id=eq.${ACCOUNT_ID}`),
  );
  await expect(page).toHaveURL(/\/$/); // switching goes back home
  await page.getByRole('button', { name: 'Strains and new origins' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/strains$/);
  await afterSwitch;
  await expect(page.getByText('Blue Oyster', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Friend Reishi', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('recent cultures and code search on the home screen stay in the current lab', async ({ signedIn: page, lab }) => {
  joinSecondLab(lab);
  const recent = page.waitForRequest((r) => r.url().includes('/rest/v1/items') && r.method() === 'GET');
  await page.goto('/');
  await expect(page.getByTestId('current-lab').filter({ visible: true })).toHaveText('Friend Lab · KL · Tech');
  expect(new URL((await recent).url()).searchParams.get('account_id')).toBe(`eq.${OTHER_LAB_ID}`);
  await expect(page.getByText('FR', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('TBG-1', { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.getByPlaceholder('Culture code').filter({ visible: true }).fill('TBG');
  await expect.poll(() => lab.rpcCalls.find((c) => c.fn === 'lookup_code')?.body).toEqual({ p_query: 'TBG', p_account_id: OTHER_LAB_ID });
  await expect(page.getByText('TBG-1', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('stats and the contamination trace ask for the current lab only', async ({ signedIn: page, lab }) => {
  joinSecondLab(lab);
  await page.goto('/stats');
  await expect.poll(() => lab.rpcCalls.find((c) => c.fn === 'stats_rows')?.body.p_account_id).toBe(OTHER_LAB_ID);
  await page.goto('/trace');
  await expect.poll(() => lab.rpcCalls.find((c) => c.fn === 'contamination_trace')?.body.p_account_id).toBe(OTHER_LAB_ID);
});

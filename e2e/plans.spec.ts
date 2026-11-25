import { expect, test } from './fixtures';

test('a new person turned away because the app is full can join the waitlist', async ({ page, lab }) => {
  lab.status.open = false;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('New@Example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByTestId('app-full')).toBeVisible();
  await page.getByRole('button', { name: 'Join the waitlist' }).click();
  await expect(page.getByTestId('on-waitlist')).toBeVisible();
  expect(lab.waitlist).toEqual(['new@example.com']);
});

test('sign-in works as normal while there is room', async ({ page, lab }) => {
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('me@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('We sent a sign-in code to me@example.com.')).toBeVisible();
  expect(lab.waitlist).toEqual([]);
});

test('an app older than the server minimum asks for an update', async ({ signedIn: page, lab }) => {
  lab.status.min_app_version = '99.0.0';
  await page.goto('/');
  await expect(page.getByTestId('update-required')).toBeVisible();
  await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0);
});

test('a notice from the server shows above the app', async ({ signedIn: page, lab }) => {
  lab.status.message = 'Maintenance tonight at 10pm.';
  await page.goto('/');
  await expect(page.getByTestId('app-notice')).toHaveText('Maintenance tonight at 10pm.');
  await expect(page.getByRole('button', { name: 'People' })).toBeVisible();
});

test('a plan limit reads as a sentence', async ({ signedIn: page }) => {
  await page.route('**/rest/v1/rpc/create_account', (r) =>
    r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'LM001', message: 'limit_reached:labs_owned:1' }) }),
  );
  await page.goto('/labs');
  await page.getByPlaceholder('Community lab').fill('Second lab');
  await page.getByRole('button', { name: 'Create lab' }).click();
  await expect(page.getByText("You've reached your plan's limit for labs you own (1).", { exact: false })).toBeVisible();
});

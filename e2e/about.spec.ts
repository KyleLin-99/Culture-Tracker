import { expect, test } from './fixtures';

test('About shows the running version', async ({ signedIn: page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+ · no channel$/);
});

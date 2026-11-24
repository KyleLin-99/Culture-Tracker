import { expect, test } from './fixtures';

// The signed-in user is a viewer in this lab: everything visible, nothing changeable.
test.beforeEach(({ lab }) => {
  lab.members.find((m) => m.role === 'owner')!.role = 'viewer';
});

test('home says so, and offers no lab settings', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByText("You're a viewer in Kyle's Lab", { exact: false })).toBeVisible();
  await expect(page.getByTestId('current-lab')).toHaveText("Kyle's Lab · KL · Viewer");
  await expect(page.getByRole('button', { name: 'Lab settings' })).toHaveCount(0);
});

test('a culture shows its lineage, history and growth, with no actions', async ({ signedIn: page }) => {
  await page.goto('/items/t-2');
  await expect(page.getByText('Slow growth')).toBeVisible();
  await expect(page.getByText('Lineage')).toBeVisible();
  for (const name of ['Transfer', 'Make backups', 'Mark contaminated', 'Retire', 'Add note', 'Log growth check']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print label' })).toBeVisible(); // printing changes nothing
});

test('strains, batches and recipes are read-only', async ({ signedIn: page }) => {
  await page.goto('/strains');
  await expect(page.getByText('Blue Oyster').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add strain' })).toHaveCount(0);

  await page.goto('/batches');
  await expect(page.getByText('Recent batches')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log run' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log batch' })).toHaveCount(0);

  await page.goto('/recipes');
  await expect(page.getByText('MEA 2% v1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);
  await page.getByText('MEA 2% v1', { exact: true }).click();
  await expect(page.getByText('For 500 ml')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
});

test('screens that only change things say why instead', async ({ signedIn: page }) => {
  await page.goto('/items/t-2/transfer');
  await expect(page.getByText("Viewers can't change this lab.")).toBeVisible();
  await page.goto('/recipes/edit');
  await expect(page.getByText("Viewers can't change this lab.")).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText("Only the lab's owners can change these.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

test('viewers can print labels from Home', async ({ signedIn: page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Print labels' }).click();
  await expect(page.getByText('No cultures yet. Pick some below.')).toBeVisible();
  await page.getByRole('radio', { name: 'Blue Oyster', exact: true }).click();
  await page.getByRole('checkbox', { name: 'TBG-1' }).click();
  await page.getByRole('button', { name: 'Add 1 culture' }).click();
  await expect(page.getByRole('button', { name: 'Print label', exact: true })).toBeEnabled();
});

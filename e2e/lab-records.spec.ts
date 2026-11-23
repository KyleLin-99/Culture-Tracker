import { expect, test } from './fixtures';

test('log a sterilization run, then a media batch made in it', async ({ signedIn: page, lab }) => {
  await page.goto('/batches');
  await page.getByPlaceholder('90').fill('45');
  await page.getByRole('button', { name: 'Log run' }).click();
  await expect(page.getByText('Logged SR-002. Write the code on the jar or sleeve.')).toBeVisible();
  expect(lab.inserts.at(-1)).toMatchObject({
    table: 'sterilization_runs',
    body: { method: 'pressure_cooker', psi: 15, minutes: 45 },
  });

  // The run just logged is picked for the next batch.
  await page.getByPlaceholder('MEA 2%, 500 ml').fill('PDA');
  await page.getByRole('button', { name: 'Log batch' }).click();
  await expect(page.getByText('Logged MB-002. Write the code on the jar or sleeve.')).toBeVisible();
  expect(lab.inserts.at(-1)).toMatchObject({
    table: 'media_batches',
    body: { kind: 'agar', recipe: 'PDA', sterilization_run_id: 'sr-2' },
  });
  await expect(page.getByText('Agar · PDA', { exact: false })).toBeVisible();
});

test('a transfer can record its media batch', async ({ signedIn: page, lab }) => {
  await page.goto('/items/t-1/transfer');
  await page.getByText('MB-001 · SR-001').click();
  await page.getByRole('button', { name: 'Create 1' }).click();

  await expect(page.getByText('TBG-1A', { exact: true })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'create_transfers')?.body).toMatchObject({
    p_parent_id: 't-1',
    p_media_batch_id: 'mb-1',
  });
});

test('liquid-culture transfers only offer LC batches', async ({ signedIn: page }) => {
  await page.goto('/items/t-1/transfer');
  await expect(page.getByText('MB-001 · SR-001')).toBeVisible();
  await page.getByText('Liquid culture').click();
  await expect(page.getByText('MB-001 · SR-001')).toBeHidden();
  await expect(page.getByText('No LC batches logged yet', { exact: false })).toBeVisible();
});

test('the contamination trace ranks likely causes', async ({ signedIn: page, lab }) => {
  await page.goto('/trace');
  await expect(page.getByText('Comparing 5 contaminated with 12 clean cultures. 2 likely causes:')).toBeVisible();

  const first = page.getByText('Sterilization run SR-002');
  await expect(first).toBeVisible();
  await expect(page.getByText('4 of 5 with SR-002 contaminated (80%) · 1 of 12 without (8%)')).toBeVisible();
  await expect(page.getByText('9.6× the risk · p = 0.010').first()).toBeVisible();
  await expect(page.getByText('Strong lead')).toHaveCount(2);
  await expect(page.getByText('Weak signal')).toHaveCount(1);

  const call = lab.rpcCalls.find((c) => c.fn === 'contamination_trace');
  expect(call?.body.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('a contaminated culture links to the trace', async ({ signedIn: page }) => {
  await page.goto('/items/t-3b');
  await page.getByRole('button', { name: 'Trace likely cause' }).click();
  await expect(page).toHaveURL(/\/trace$/);
});

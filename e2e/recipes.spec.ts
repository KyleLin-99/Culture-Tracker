import { expect, test } from './fixtures';

const ingredients = (page: import('@playwright/test').Page) =>
  page.getByTestId('ingredient').filter({ visible: true }).allInnerTexts();

test('save a new recipe from a template', async ({ signedIn: page, lab }) => {
  await page.goto('/recipes');
  await page.getByRole('button', { name: 'New recipe' }).click();
  await page.getByRole('link', { name: 'LME liquid culture 2%' }).click();
  await page.getByLabel('Name').fill('LME 2% house');
  await page.getByRole('button', { name: 'Save recipe' }).click();

  await expect(page.getByText('LME 2% house v1', { exact: true })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'save_recipe')?.body).toMatchObject({
    p_family_id: null,
    p_name: 'LME 2% house',
    p_kind: 'lc',
    p_volume_ml: 1000,
    p_ingredients: [
      { name: 'Light malt extract', amount: 20, unit: 'g' },
      { name: 'Water', amount: 1000, unit: 'ml' },
    ],
  });
});

test('a recipe asks for complete ingredients before saving', async ({ signedIn: page, lab }) => {
  await page.goto('/recipes/edit');
  await page.getByLabel('Name').fill('Half done');
  await page.getByLabel('Ingredient 1').fill('Agar');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page.getByText('Each ingredient needs a name, an amount and a unit.')).toBeVisible();
  expect(lab.rpcCalls.some((c) => c.fn === 'save_recipe')).toBe(false);
});

test('scale a recipe to the batch size', async ({ signedIn: page }) => {
  await page.goto('/recipes');
  await page.getByText('MEA 2% v1', { exact: true }).click();
  await expect(page.getByText('For 500 ml')).toBeVisible();
  expect(await ingredients(page)).toEqual(['10 g Light malt extract', '10 g Agar']);

  await page.getByLabel('Batch size (ml)').fill('750');
  await expect(page.getByText('For 750 ml')).toBeVisible();
  expect(await ingredients(page)).toEqual(['15 g Light malt extract', '15 g Agar']);
});

test('editing saves a new version and keeps the old one', async ({ signedIn: page, lab }) => {
  await page.goto('/recipes/fam-mea');
  await page.getByRole('button', { name: 'Edit (saves as v2)' }).click();
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page.getByLabel('Ingredient 3').fill('Nutritional yeast');
  await page.getByLabel('Amount').nth(2).fill('1');
  await page.getByRole('button', { name: 'Save version 2' }).click();

  await expect(page.getByText('MEA 2% v2', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'save_recipe')?.body).toMatchObject({ p_family_id: 'fam-mea' });
  await expect(page.getByText('MEA 2% v1', { exact: true }).filter({ visible: true })).toBeVisible(); // in Versions
});

test('log a batch from a recipe, scaled to what was made', async ({ signedIn: page, lab }) => {
  await page.goto('/batches');
  await page.getByText('MEA 2% v1', { exact: true }).click();
  await page.getByLabel('Batch size (ml)').fill('250');
  await expect(page.getByText('For 250 ml')).toBeVisible();
  expect(await ingredients(page)).toEqual(['5 g Light malt extract', '5 g Agar']);

  await page.getByRole('button', { name: 'Log batch' }).click();
  await expect(page.getByText('Logged MB-002. Write the code on the jar or sleeve.')).toBeVisible();
  expect(lab.inserts.at(-1)).toMatchObject({
    table: 'media_batches',
    body: { kind: 'agar', recipe_id: 'rc-mea-1', volume_ml: 250 },
  });
  await expect(page.getByText('Agar · MEA 2% v1 · 250 ml', { exact: false })).toBeVisible();
});

test('archiving a recipe asks first', async ({ signedIn: page, lab }) => {
  await page.goto('/recipes/fam-mea');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Keep' }).click();
  expect(lab.rpcCalls.some((c) => c.fn === 'archive_recipe')).toBe(false);

  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Archive recipe' }).click();
  await expect(page.getByText('No recipes yet.', { exact: false })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'archive_recipe')?.body).toEqual({ p_family_id: 'fam-mea' });
});

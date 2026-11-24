import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

/** The document sent to the printer (web prints it from a hidden frame). */
const printed = async (page: Page) => {
  const frame = page.locator('#label-print-frame');
  await expect(frame).toHaveCount(1);
  return (await frame.getAttribute('srcdoc')) ?? '';
};

test('print a label from a culture', async ({ signedIn: page }) => {
  await page.goto('/items/t-1');
  await page.getByRole('button', { name: 'Print label' }).click();

  const preview = page.getByTestId('label-preview');
  await expect(preview).toHaveCount(1);
  await expect(preview).toContainText('TBG-1');
  await expect(preview).toContainText('Blue Oyster');
  await expect(preview).toContainText('11/23/26 · KL');

  await page.getByRole('button', { name: 'Print label' }).click();
  const html = await printed(page);
  expect(html).toContain('<div class="code">TBG-1</div>');
  expect(html).toContain('size: 90mm 29mm');
  expect(html).toContain('<svg'); // the QR code
});

test('the label stock choice is remembered', async ({ signedIn: page }) => {
  await page.goto('/labels?ids=t-1,t-2');
  await page.getByText('Letter sheet, 30 labels').click();
  await page.getByRole('button', { name: 'Print 2 labels' }).click();
  expect(await printed(page)).toContain('size: letter');

  await page.reload();
  await page.getByRole('button', { name: 'Print 2 labels' }).click();
  expect(await printed(page)).toContain('grid-template-columns: repeat(3, 2.625in)');
});

test('new transfers go straight to printing their labels', async ({ signedIn: page }) => {
  await page.goto('/items/t-3/transfer');
  await page.getByLabel('More').click();
  await page.getByRole('button', { name: 'Create 2' }).click();
  await page.getByRole('button', { name: 'Print 2 labels' }).click();

  const preview = page.getByTestId('label-preview');
  await expect(preview).toHaveCount(2);
  await expect(preview.nth(0)).toContainText('TBG-3C');
  await expect(preview.nth(1)).toContainText('TBG-3D');
});

test('home has a scanner, with typing the code as the fallback', async ({ signedIn: page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan label' }).click();
  await expect(page.getByText('Type the code instead').filter({ visible: true })).toBeVisible();
  await page.getByRole('link', { name: 'Type the code instead' }).filter({ visible: true }).click();
  await expect(page.getByPlaceholder('Culture code')).toBeVisible();
});

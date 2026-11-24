import type { Page } from '@playwright/test';

import { expect, STRAIN_ID, test } from './fixtures';

// A real print() can open a print dialog that blocks the browser. Swap it, in
// every frame (the labels print from their own frame), for a counter on the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { print: () => void; top: { __prints?: number } };
    w.print = () => {
      w.top.__prints = (w.top.__prints ?? 0) + 1;
    };
  });
});

/** The document sent to the printer (web prints it from a hidden frame), once print was called. */
const printed = async (page: Page, times = 1) => {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prints?: number }).__prints ?? 0)).toBe(times);
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

  await page.reload(); // the counter starts again with the page
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
  // No camera in CI: answer the permission check the same way on every browser version.
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d: PermissionDescriptor) =>
      (d.name as string) === 'camera' ? Promise.resolve({ state: 'prompt' } as PermissionStatus) : query(d);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan label' }).click();
  await expect(page.getByText('Type the code instead').filter({ visible: true })).toBeVisible();
  await page.getByRole('link', { name: 'Type the code instead' }).filter({ visible: true }).click();
  await expect(page.getByPlaceholder('Culture code')).toBeVisible();
});

// Kyle's validation feedback: pick cultures here, copies, fill a sheet, start part-way, QR only.

const count = (html: string, cls: string) => html.match(new RegExp(`class="label ${cls}"`, 'g'))?.length ?? 0;
const labelCount = (html: string) => html.match(/class="label[ "]/g)?.length ?? 0;
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

test('print labels from Home, picking cultures by strain and generation', async ({ signedIn: page, lab }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Print labels' }).click();
  await expect(page.getByText('No cultures yet. Pick some below.')).toBeVisible();
  await expect(page.getByTestId('label-preview')).toHaveCount(0);

  await radio(page, 'Blue Oyster').click();
  await expect.poll(() => lab.rpcCalls.find((c) => c.fn === 'strain_tree')?.body).toEqual({ p_strain_id: STRAIN_ID });

  // Active cultures only: TBG-3B is contaminated.
  await expect(page.getByRole('checkbox', { name: 'TBG-3B' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(6);

  await radio(page, 'Gen 1').click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select all' }).click();
  // Bug found here: accessibilityState={{ checked }} isn't exposed on web, so the
  // ticked state was invisible to screen readers (fixed with aria-checked).
  await expect(page.getByRole('checkbox', { name: 'TBG-1' })).toBeChecked();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('checkbox', { name: 'TBG-1' })).not.toBeChecked();

  await page.getByRole('checkbox', { name: 'TBG-1' }).click();
  await page.getByRole('checkbox', { name: 'TBG-2' }).click();
  await page.getByRole('button', { name: 'Add 2 cultures' }).click();
  await expect(page).toHaveURL(/ids=t-1(%2C|,)t-2/);
  const preview = page.getByTestId('label-preview');
  await expect(preview).toHaveCount(2);
  await expect(page.getByText('No cultures yet. Pick some below.')).toHaveCount(0);

  // Adding one again doesn't duplicate it.
  await radio(page, 'Origins').click();
  await page.getByRole('checkbox', { name: 'TBG' }).click();
  await page.getByRole('button', { name: 'Add 1 culture' }).click();
  await expect(preview).toHaveCount(3);
  await radio(page, 'Gen 1').click();
  await page.getByRole('checkbox', { name: 'TBG-2' }).click();
  await page.getByRole('button', { name: 'Add 1 culture' }).click();
  await expect(preview).toHaveCount(3);

  await preview.filter({ hasText: 'TBG-1' }).getByRole('link', { name: 'Remove' }).click();
  await expect(preview).toHaveCount(2);
  await expect(preview.filter({ hasText: 'TBG-1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print 2 labels' })).toBeVisible();
});

test('generation choices only show when a strain has more than one', async ({ signedIn: page, lab }) => {
  lab.items = lab.items.filter((i) => i.generation === 0);
  await page.goto('/labels');
  await radio(page, 'Blue Oyster').click();
  await expect(page.getByRole('checkbox', { name: 'TBG' })).toBeVisible();
  await expect(radio(page, 'Origins')).toHaveCount(0);
});

test('copies of each culture print next to each other', async ({ signedIn: page }) => {
  await page.goto('/labels?ids=t-1,t-2');
  await radio(page, '5').click();
  await expect(page.getByRole('button', { name: 'Print 10 labels' })).toBeVisible();
  await expect(page.getByTestId('label-preview').first()).toContainText('× 5');

  await page.getByRole('button', { name: 'Print 10 labels' }).click();
  const html = await printed(page);
  expect(labelCount(html)).toBe(10);
  expect(html.indexOf('TBG-2</div>')).toBeGreaterThan(html.lastIndexOf('TBG-1</div>'));
});

test('fill the sheet, starting part-way down a used one', async ({ signedIn: page }) => {
  await page.goto('/labels?ids=t-1');
  await page.getByText('Letter sheet, 30 labels').click();
  await radio(page, 'Fill the sheet').click();
  await expect(page.getByRole('button', { name: 'Print 30 labels' })).toBeVisible();
  await expect(page.getByText(/That's \d+ sheets/)).toHaveCount(0);

  for (let i = 0; i < 3; i += 1) await page.getByLabel('More').click(); // start at label 4
  await expect(page.getByRole('button', { name: 'Print 27 labels' })).toBeVisible();
  await page.getByRole('button', { name: 'Print 27 labels' }).click();
  const html = await printed(page);
  expect(count(html, 'blank')).toBe(3);
  expect(labelCount(html)).toBe(30); // 3 blank + 27
});

test('more than a sheet says how many sheets', async ({ signedIn: page }) => {
  await page.goto('/labels?ids=t-1,t-2,t-3,t-2a');
  await page.getByText('Letter sheet, 30 labels').click();
  await radio(page, '10').click();
  await expect(page.getByRole('button', { name: 'Print 40 labels' })).toBeVisible();
  await expect(page.getByText("That's 2 sheets.")).toBeVisible();
});

test('QR code only, remembered', async ({ signedIn: page }) => {
  await page.goto('/labels?ids=t-1,t-2');
  await radio(page, 'QR code only').click();
  const preview = page.getByTestId('label-preview');
  await expect(preview.first()).not.toContainText('Blue Oyster');

  await page.getByRole('button', { name: 'Print 2 labels' }).click();
  const html = await printed(page);
  expect(count(html, 'qr-only')).toBe(2);
  expect(html).not.toContain('<div class="code">');

  await page.reload();
  await expect(preview.first()).not.toContainText('Blue Oyster');
});

test('a Brother roll has no fill or start position, and falls back to 1 copy', async ({ signedIn: page }) => {
  await page.goto('/labels?ids=t-1');
  await page.getByText('Letter sheet, 30 labels').click();
  await radio(page, 'Fill the sheet').click();
  await page.getByLabel('More').click();
  await expect(page.getByRole('button', { name: 'Print 29 labels' })).toBeVisible();

  await page.getByText('Brother 29 × 90 mm').click();
  await expect(radio(page, 'Fill the sheet')).toHaveCount(0);
  await expect(page.getByText('Start at label', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print label', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Print label', exact: true }).click();
  const html = await printed(page);
  expect(labelCount(html)).toBe(1);
  expect(count(html, 'blank')).toBe(0);
});

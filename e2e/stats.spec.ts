import { expect, type Lab, test } from './fixtures';

/** The local date n days ago, as the app computes it. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let n = 0;
function plate(lab: Lab, o: Record<string, unknown>) {
  const id = `st-${(n += 1)}`;
  lab.statsRows.push({
    id, strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1, made_on: daysAgo(10),
    status: 'active', contaminated: false, batch_id: null, batch_code: null, run_id: null, run_code: null,
    recipe_family: null, recipe_name: null, ...o,
  });
  return id;
}

const mea = { batch_id: 'b1', batch_code: 'MB-001', run_id: 'r1', run_code: 'SR-001', recipe_family: 'f-mea', recipe_name: 'MEA 2%' };
const pda = { batch_id: 'b2', batch_code: 'MB-002', run_id: 'r1', run_code: 'SR-001', recipe_family: 'f-pda', recipe_name: 'PDA' };

test('an empty period says so', async ({ signedIn: page }) => {
  await page.goto('/stats');
  await expect(page.getByTestId('stats-overall')).toHaveText('No transfers or backups in this period.');
});

test('contamination by recipe, then by generation', async ({ signedIn: page, lab }) => {
  plate(lab, { ...mea, contaminated: true });
  plate(lab, { ...mea, contaminated: true });
  plate(lab, { ...mea });
  plate(lab, { ...pda, generation: 2 });
  plate(lab, { generation: 3 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Stats' }).click();

  await expect(page.getByTestId('stats-overall')).toHaveText('2 of 5 plates contaminated (40%)');
  const rows = page.getByTestId('stat-row');
  await expect(rows).toHaveCount(3);
  expect(await rows.allInnerTexts()).toEqual([
    expect.stringMatching(/^MEA 2%\s+67% of 3$/),
    expect.stringMatching(/^PDA\s+0% of 1$/),
    expect.stringMatching(/^Not recorded\s+0% of 1$/),
  ]);

  await page.getByText('Generation', { exact: true }).click();
  expect(await rows.allInnerTexts()).toEqual([
    expect.stringMatching(/^Gen 1\s+67% of 3$/),
    expect.stringMatching(/^Gen 2\s+0% of 1$/),
    expect.stringMatching(/^Gen 3\s+0% of 1$/),
  ]);
});

test('the period changes which plates count', async ({ signedIn: page, lab }) => {
  plate(lab, { made_on: daysAgo(5), contaminated: true });
  plate(lab, { made_on: daysAgo(200) });
  await page.goto('/stats');
  await expect(page.getByTestId('stats-overall')).toHaveText('1 of 1 plates contaminated (100%)');
  await page.getByText('1 year', { exact: true }).click();
  await expect(page.getByTestId('stats-overall')).toHaveText('1 of 2 plates contaminated (50%)');
  expect(lab.rpcCalls.filter((c) => c.fn === 'stats_rows').map((c) => c.body.p_from)).toEqual([daysAgo(90), daysAgo(365)]);
});

test('growth by strain averages the plates with checks', async ({ signedIn: page, lab }) => {
  const a = plate(lab, { made_on: daysAgo(10) });
  const b = plate(lab, { made_on: daysAgo(10) });
  plate(lab, { made_on: daysAgo(10) }); // no checks
  const check = (item_id: string, day: number, radius_mm: number) => ({
    id: `c-${item_id}-${day}`, account_id: 'x', item_id, checked_on: daysAgo(10 - day), percent: null, radius_mm, note: null,
    source: 'manual', created_at: `${daysAgo(10 - day)}T12:00:00Z`, deleted_at: null,
  });
  lab.checks.push(check(a, 4, 12), check(b, 4, 8));
  await page.goto('/stats');
  await expect(page.getByTestId('strain-growth')).toHaveText('2.5 mm/day');
  await expect(page.getByText('Average over 2 cultures with checks')).toBeVisible();
});

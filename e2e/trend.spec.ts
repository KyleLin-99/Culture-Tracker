// Stats: contamination over time, and technique changes compared before and after.
// The verdict maths is in src/domain/__tests__/trend.test.ts; these check what's shown.
import { expect, type Lab, test } from './fixtures';

/** The local date n days ago (negative: ahead), as the app computes it. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const labelDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
};

let n = 0;
/** `total` plates made `ago` days ago, the first `contaminated` of them contaminated. */
function plates(lab: Lab, ago: number, total: number, contaminated: number) {
  for (let i = 0; i < total; i += 1) {
    lab.statsRows.push({
      id: `tp-${(n += 1)}`, strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1,
      made_on: daysAgo(ago), status: i < contaminated ? 'contaminated' : 'active', contaminated: i < contaminated,
      batch_id: null, batch_code: null, run_id: null, run_code: null, recipe_family: null, recipe_name: null,
    });
  }
}

function change(lab: Lab, id: string, ago: number, title: string, note: string | null = null) {
  lab.techniqueChanges.push({
    id, account_id: '00000000-0000-4000-8000-0000000000ac', changed_on: daysAgo(ago), title, note,
    created_at: `${daysAgo(ago)}T12:00:00Z`, deleted_at: null,
  });
}

/**
 * #1 (100 days ago, before the 90-day period): 1/10 before, 8/10 after → worse.
 * #2 (40 days ago): 8/10 before, 1/10 after → better (p ≈ 0.005).
 * #3 (3 days ago): no plates since → too few.
 */
function seedChanges(lab: Lab) {
  plates(lab, 115, 10, 1);
  plates(lab, 85, 10, 8);
  plates(lab, 50, 10, 8);
  plates(lab, 20, 10, 1);
  change(lab, 'tc-old', 100, 'Switched to PDA');
  change(lab, 'tc-hood', 40, 'Started using a flow hood', 'Laminar flow, 2x2 ft');
  change(lab, 'tc-new', 3, 'Longer sterilization');
}

test('the chart shows a point per week with plates, gaps between them, and numbered change markers', async ({ signedIn: page, lab }) => {
  seedChanges(lab);
  await page.goto('/stats');
  const chart = page.getByTestId('trend-chart');
  await expect(chart).toBeVisible();

  // Three weeks with plates in the last 90 days, each its own point; empty weeks break the line.
  await expect(chart.locator('circle')).toHaveCount(3);
  const d = (await chart.locator('path').first().getAttribute('d')) ?? '';
  expect(d.match(/M/g)).toHaveLength(3);
  expect(d).not.toContain('L');
  await expect(chart).toHaveAttribute('aria-label', /^Contamination over time\. \d+\/\d+: 80% of 10; \d+\/\d+: 80% of 10; \d+\/\d+: 10% of 10$/);
  await expect(chart.getByText('n=10')).not.toHaveCount(0);

  // Changes 2 and 3 fall in the period; change 1 is older, so it has a card but no marker.
  await expect(chart.locator('line[stroke-dasharray]')).toHaveCount(2);
  await expect(chart.getByText('2', { exact: true })).toBeVisible();
  await expect(chart.getByText('3', { exact: true })).toBeVisible();
  await expect(chart.getByText('1', { exact: true })).toHaveCount(0);
});

test('with no plates the chart says so', async ({ signedIn: page }) => {
  await page.goto('/stats');
  await expect(page.getByTestId('trend-chart')).toHaveAttribute('aria-label', 'Contamination over time. No plates yet.');
  await expect(page.getByTestId('trend-chart').locator('circle')).toHaveCount(0);
  await expect(page.getByText('None yet.')).toBeVisible();
});

// (Choices doesn't expose which chip is selected on web, so these check the chart.)
test('per week or per month: weeks by default for 90 days, and a switch', async ({ signedIn: page, lab }) => {
  plates(lab, 20, 4, 1);
  plates(lab, 50, 4, 3);
  await page.goto('/stats');
  const chart = page.getByTestId('trend-chart');
  await expect(chart).toHaveAttribute('aria-label', /^Contamination over time\. \d+\/\d+: 75% of 4; \d+\/\d+: 25% of 4$/);
  await expect(page.getByText('n = plates made that week.', { exact: false })).toBeVisible();

  await expect(page.getByRole('radio', { name: 'Week', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Month', exact: true }).click();
  // Choices used to tell browsers nothing about which option was picked.
  await expect(page.getByRole('radio', { name: 'Month', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Week', exact: true })).not.toBeChecked();
  await expect(chart).toHaveAttribute('aria-label', /^Contamination over time\. [A-Z][a-z]{2} \d{2}: 75% of 4; [A-Z][a-z]{2} \d{2}: 25% of 4$/);
  await expect(page.getByText('n = plates made that month.', { exact: false })).toBeVisible();

  await page.getByRole('radio', { name: 'Week', exact: true }).click();
  await expect(chart).toHaveAttribute('aria-label', /^Contamination over time\. \d+\/\d+: 75% of 4; \d+\/\d+: 25% of 4$/);
  await expect(page.getByText('n = plates made that week.', { exact: false })).toBeVisible();
});

test('a year defaults to months', async ({ signedIn: page, lab }) => {
  plates(lab, 20, 4, 1);
  await page.goto('/stats');
  await page.getByText('1 year', { exact: true }).click();
  await expect(page.getByTestId('trend-chart')).toHaveAttribute('aria-label', /^Contamination over time\. [A-Z][a-z]{2} \d{2}: 25% of 4$/);
  await expect(page.getByText('n = plates made that month.', { exact: false })).toBeVisible();
});

test('each change is compared 30 days before and after, newest first, with a verdict', async ({ signedIn: page, lab }) => {
  seedChanges(lab);
  await page.goto('/stats');

  const compare = page.getByTestId('technique-compare');
  await expect(compare).toHaveCount(3);
  expect(await compare.allInnerTexts()).toEqual([
    '30 days before: 10% of 10 · since: no plates',
    '30 days before: 80% of 10 · since: 10% of 10',
    '30 days before: 10% of 10 · since: 80% of 10',
  ]);
  await expect(page.getByText('3 · Longer sterilization')).toBeVisible();
  await expect(page.getByText('2 · Started using a flow hood')).toBeVisible();
  await expect(page.getByText('1 · Switched to PDA')).toBeVisible();
  await expect(page.getByText(labelDate(daysAgo(40)), { exact: true })).toBeVisible();
  await expect(page.getByText('Laminar flow, 2x2 ft')).toBeVisible();

  await expect(page.getByText('Too few plates to compare yet (need 5 on each side).')).toBeVisible();
  await expect(page.getByText('Likely a real improvement (p = 0.01).')).toBeVisible();
  await expect(page.getByText('Likely got worse (p = 0.01).')).toBeVisible();

  // The oldest change's month before (130 days ago) is fetched, though the period is 90 days.
  expect(lab.rpcCalls.filter((c) => c.fn === 'stats_rows').map((c) => c.body.p_from)).toEqual([daysAgo(130)]);
  // ...but those extra plates don't count in the period's figures.
  await expect(page.getByTestId('stats-overall')).toHaveText('17 of 30 plates contaminated (57%)');
});

test('a change with a difference that could be chance says so', async ({ signedIn: page, lab }) => {
  plates(lab, 50, 10, 3);
  plates(lab, 20, 10, 1);
  change(lab, 'tc-1', 40, 'New gloves');
  await page.goto('/stats');
  await expect(page.getByTestId('technique-compare')).toHaveText('30 days before: 30% of 10 · since: 10% of 10');
  await expect(page.getByText('Could be chance (p = 0.58). Keep going and check again later.')).toBeVisible();
});

test('add a change: checks the title and date, then saves it to this lab', async ({ signedIn: page, lab }) => {
  await page.goto('/stats');
  const title = page.getByLabel('What changed');
  const date = page.getByLabel('Date (YYYY-MM-DD)');
  const add = page.getByRole('button', { name: 'Add change' });
  await expect(date).toHaveValue(daysAgo(0)); // today by default

  await add.click();
  await expect(page.getByText('Say what changed, e.g. "Started using a flow hood".')).toBeVisible();
  await title.fill('   ');
  await add.click();
  await expect(page.getByText('Say what changed, e.g. "Started using a flow hood".')).toBeVisible();

  await title.fill('  Started using a flow hood  ');
  for (const bad of ['11/20/2026', '2026-1-5', 'yesterday', '2026-13-01']) {
    await date.fill(bad);
    await add.click();
    await expect(page.getByText('Date is YYYY-MM-DD.')).toBeVisible();
  }
  // Bug: 2026-02-31 passed the date check (the browser rolls it to March 3) and
  // reached the server, which refused it with a database error.
  await date.fill('2026-02-31');
  await add.click();
  await expect(page.getByText('Date is YYYY-MM-DD.')).toBeVisible();

  await date.fill(daysAgo(-1));
  await add.click();
  await expect(page.getByText('That date is in the future.')).toBeVisible();
  expect(lab.inserts.filter((i) => i.table === 'technique_changes')).toEqual([]);

  await date.fill(daysAgo(7));
  await page.getByLabel('Details (optional)').fill('Laminar flow');
  await add.click();
  await expect(page.getByText('1 · Started using a flow hood')).toBeVisible();
  await expect(page.getByText('Date is YYYY-MM-DD.')).toHaveCount(0);
  expect(lab.inserts.filter((i) => i.table === 'technique_changes').map((i) => i.body)).toEqual([
    { account_id: '00000000-0000-4000-8000-0000000000ac', changed_on: daysAgo(7), title: 'Started using a flow hood', note: 'Laminar flow' },
  ]);
  // The form is cleared for the next one, and the chart gets a marker.
  await expect(title).toHaveValue('');
  await expect(page.getByLabel('Details (optional)')).toHaveValue('');
  await expect(page.getByTestId('trend-chart').locator('line[stroke-dasharray]')).toHaveCount(1);
  await expect(page.getByText('Too few plates to compare yet (need 5 on each side).')).toBeVisible();
});

test('a change dated today is fine, and no details are saved as none', async ({ signedIn: page, lab }) => {
  await page.goto('/stats');
  await page.getByLabel('What changed').fill('MEA 2%');
  await page.getByRole('button', { name: 'Add change' }).click();
  await expect(page.getByText('1 · MEA 2%')).toBeVisible();
  expect(lab.inserts.filter((i) => i.table === 'technique_changes').map((i) => i.body)).toEqual([
    { account_id: '00000000-0000-4000-8000-0000000000ac', changed_on: daysAgo(0), title: 'MEA 2%', note: null },
  ]);
});

test('remove a change: Keep leaves it, Remove change removes it', async ({ signedIn: page, lab }) => {
  seedChanges(lab);
  await page.goto('/stats');
  await expect(page.getByTestId('technique-compare')).toHaveCount(3);

  await page.getByRole('link', { name: 'Remove', exact: true }).nth(1).click(); // #2, the flow hood
  await expect(page.getByRole('link', { name: 'Remove', exact: true })).toHaveCount(2);
  await page.getByRole('link', { name: 'Keep' }).click();
  await expect(page.getByRole('link', { name: 'Remove', exact: true })).toHaveCount(3);
  await expect(page.getByText('2 · Started using a flow hood')).toBeVisible();
  expect(lab.inserts.filter((i) => i.table === 'technique_changes:update')).toEqual([]);

  await page.getByRole('link', { name: 'Remove', exact: true }).nth(1).click();
  await page.getByRole('link', { name: 'Remove change' }).click();
  await expect(page.getByText('Started using a flow hood')).toHaveCount(0);
  await expect(page.getByTestId('technique-compare')).toHaveCount(2);
  const updates = lab.inserts.filter((i) => i.table === 'technique_changes:update').map((i) => i.body);
  expect(updates).toEqual([{ id: 'tc-hood', deleted_at: expect.any(String) }]);
  // Numbers follow the changes left: the newest is now #2.
  await expect(page.getByText('2 · Longer sterilization')).toBeVisible();
  await expect(page.getByTestId('trend-chart').locator('line[stroke-dasharray]')).toHaveCount(1);
});

test('a viewer sees the changes and verdicts but can\'t add or remove', async ({ signedIn: page, lab }) => {
  lab.members.find((m) => m.role === 'owner')!.role = 'viewer';
  seedChanges(lab);
  await page.goto('/stats');
  await expect(page.getByTestId('technique-compare')).toHaveCount(3);
  await expect(page.getByText('Likely a real improvement (p = 0.01).')).toBeVisible();
  await expect(page.getByTestId('trend-chart').locator('line[stroke-dasharray]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Add change' })).toHaveCount(0);
  await expect(page.getByLabel('What changed')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Remove', exact: true })).toHaveCount(0);
});

test('only this lab\'s changes are listed', async ({ signedIn: page, lab }) => {
  change(lab, 'tc-1', 10, 'Ours');
  lab.techniqueChanges.push({
    id: 'tc-other', account_id: '00000000-0000-4000-8000-0000000000bb', changed_on: daysAgo(5), title: 'Theirs', note: null,
    created_at: `${daysAgo(5)}T12:00:00Z`, deleted_at: null,
  });
  await page.goto('/stats');
  await expect(page.getByText('1 · Ours')).toBeVisible();
  await expect(page.getByText('Theirs')).toHaveCount(0);
});

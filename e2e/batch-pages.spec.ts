// Batches and runs open their own pages: what went into a batch, where it was
// sterilized, the cultures made on it, and how they contaminate next to the rest
// of the lab. Which plates count and how they're ordered is tested against the
// database in integration/ and src/offline/__tests__/queries.test.ts; this is
// what a person sees and taps.
import { expect, test, type Lab } from './fixtures';

const MADE_ON = '2026-11-23';

/**
 * MB-001 (MEA 2% v1, 250 ml) and MB-002 went through SR-001; MB-003 (honey LC)
 * has no run and nothing made on it. TBG-1 and TBG-2A were made on MB-001, TBG-3
 * on MB-002. Plates over the same dates: MB-001 1 of 3 contaminated, MB-002 1 of 1,
 * four plates from no batch, all clean.
 */
function seedBatchPages(lab: Lab) {
  Object.assign(lab.batches[0], {
    recipe_id: 'rc-mea-1', volume_ml: 250, deleted_at: null,
    recipes: { name: 'MEA 2%', version: 1, family_id: 'fam-mea' },
  });
  lab.batches.push(
    { id: 'mb-2', account_id: lab.batches[0].account_id, code: 'MB-002', kind: 'agar', recipe: 'PDA', sterilization_run_id: 'run-1', recipe_id: null, volume_ml: null, made_on: MADE_ON, notes: null, created_at: `${MADE_ON}T11:30:00Z`, deleted_at: null, sterilization_runs: { code: 'SR-001' }, recipes: null },
    { id: 'mb-3', account_id: lab.batches[0].account_id, code: 'MB-003', kind: 'lc', recipe: 'Honey', sterilization_run_id: null, recipe_id: null, volume_ml: null, made_on: MADE_ON, notes: null, created_at: `${MADE_ON}T11:45:00Z`, deleted_at: null, sterilization_runs: null, recipes: null },
  );
  const onBatch = (id: string, batch: string) =>
    Object.assign(lab.items.find((i) => i.id === id)!, { media_batch_id: batch, media_batches: { code: batch === 'mb-1' ? 'MB-001' : 'MB-002', sterilization_runs: { code: 'SR-001' } } });
  onBatch('t-1', 'mb-1');
  onBatch('t-2a', 'mb-1');
  onBatch('t-3', 'mb-2');

  let n = 0;
  const plate = (batch: string | null, contaminated: boolean) => ({
    id: `p-${(n += 1)}`, strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1,
    made_on: MADE_ON, status: contaminated ? 'contaminated' : 'active', contaminated,
    batch_id: batch, batch_code: batch, run_id: batch ? 'run-1' : null, run_code: batch ? 'SR-001' : null,
    recipe_family: null, recipe_name: null,
  });
  lab.statsRows.push(
    plate('mb-1', true), plate('mb-1', false), plate('mb-1', false),
    plate('mb-2', true),
    plate(null, false), plate(null, false), plate(null, false), plate(null, false),
  );
}

test('a batch opens from Batches and runs, and its run, recipe and cultures open from it', async ({ signedIn: page, lab }) => {
  seedBatchPages(lab);
  const visible = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });
  const link = (name: string) => page.getByRole('link', { name, exact: true }).filter({ visible: true });
  const opened = async (path: RegExp) => expect(page).toHaveURL(path, { timeout: 10_000 });

  await test.step('tap a batch in the list', async () => {
    await page.goto('/batches');
    await visible('MB-001').click({ timeout: 10_000 });
    await opened(/\/batch\/mb-1$/);
  });

  await test.step('the batch page shows its run, recipe scaled to the batch, and cultures', async () => {
    await expect(visible('Sterilized in')).toBeVisible();
    await expect(link('SR-001')).toBeVisible();
    await expect(link('MEA 2% v1')).toBeVisible();
    await expect(visible('For 250 ml')).toBeVisible();
    // The recipe is for 500 ml; this batch is 250 ml, so half of each.
    await expect(page.getByTestId('ingredient').filter({ visible: true })).toHaveText(['5 g Light malt extract', '5 g Agar']);
    await expect(visible('Cultures made from it (2)')).toBeVisible();
    await expect(visible('TBG-1')).toBeVisible();
    await expect(visible('TBG-2A')).toBeVisible();
    await expect(visible('TBG-3')).toHaveCount(0); // made on MB-002
  });

  await test.step('contamination next to the rest of the lab over the same dates', async () => {
    await expect(visible('33% · 1 of 3 plates')).toBeVisible();
    await expect(visible('Rest of the lab, same dates: 20% · 1 of 5')).toBeVisible();
    await expect(visible('Few plates so far, so treat the rate as a rough guide.')).toBeVisible();
    // A month before the batch was made, to three months after (or today), for this lab.
    const call = lab.rpcCalls.find((c) => c.fn === 'stats_rows');
    expect(call?.body).toMatchObject({ p_from: '2026-10-24', p_account_id: lab.members[0].account_id });
    expect(String(call?.body.p_to) >= MADE_ON && String(call?.body.p_to) <= '2027-02-21').toBe(true);
  });

  await test.step('the recipe link opens the recipe', async () => {
    await link('MEA 2% v1').click({ timeout: 10_000 });
    await opened(/\/recipes\/fam-mea$/);
    await page.goBack();
    await opened(/\/batch\/mb-1$/);
  });

  await test.step('a culture opens from the batch', async () => {
    await visible('TBG-2A').click({ timeout: 10_000 });
    await opened(/\/items\/t-2a$/);
    await page.goBack();
    await opened(/\/batch\/mb-1$/);
  });

  await test.step('the run opens from the batch and lists its batches and cultures', async () => {
    await link('SR-001').click({ timeout: 10_000 });
    await opened(/\/run\/run-1$/);
    await expect(visible('Batches in this run')).toBeVisible();
    await expect(visible('MB-001')).toBeVisible();
    await expect(visible('MB-002')).toBeVisible();
    await expect(visible('MB-003')).toHaveCount(0); // no run
    await expect(visible('Cultures made from it (3)')).toBeVisible();
    for (const code of ['TBG-1', 'TBG-2A', 'TBG-3']) await expect(visible(code)).toBeVisible();
    await expect(visible('50% · 2 of 4 plates')).toBeVisible();
    await expect(visible('Rest of the lab, same dates: 0% · 0 of 4')).toBeVisible();
  });

  await test.step('a batch in the run opens its page', async () => {
    await visible('MB-002').click({ timeout: 10_000 });
    await opened(/\/batch\/mb-2$/);
    await expect(visible('Cultures made from it (1)')).toBeVisible();
    await expect(visible('TBG-3')).toBeVisible();
    await expect(visible('100% · 1 of 1 plates')).toBeVisible();
  });

  await test.step('"‹ Batches and runs" goes back to the list', async () => {
    await link('‹ Batches and runs').click({ timeout: 10_000 });
    await opened(/\/batches$/);
    await expect(page.getByRole('button', { name: 'Log run' }).filter({ visible: true })).toBeVisible();
  });
});

test('a run opens from Batches and runs, and goes back', async ({ signedIn: page, lab }) => {
  seedBatchPages(lab);
  const visible = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });

  await page.goto('/batches');
  // The run's card in the list (SR-001 is also a choice in the new-batch form).
  await visible('Pressure cooker · 15 psi · 90 min · 11/23/26').click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/run\/run-1$/, { timeout: 10_000 });
  await expect(visible('Batches in this run')).toBeVisible();
  await expect(visible('MB-001')).toBeVisible();

  await page.getByRole('link', { name: '‹ Batches and runs' }).filter({ visible: true }).click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/batches$/, { timeout: 10_000 });
});

test('a batch with no plates says so, and one opened from a link still goes back', async ({ signedIn: page, lab }) => {
  seedBatchPages(lab);
  const visible = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });

  await page.goto('/batch/mb-3');
  await expect(visible('MB-003').first()).toBeVisible({ timeout: 10_000 });
  await expect(visible('Not recorded.')).toBeVisible(); // no run
  await expect(visible('Recipe')).toHaveCount(0); // free-text recipe only
  await expect(visible("No plates from this yet, or none scored (clean plates that were discarded don't count).")).toBeVisible();
  await expect(visible('Few plates so far, so treat the rate as a rough guide.')).toHaveCount(0);
  await expect(visible('Cultures made from it (0)')).toBeVisible();
  await expect(visible('None yet. Pick this batch when you transfer onto it.')).toBeVisible();

  await page.getByRole('link', { name: '‹ Batches and runs' }).filter({ visible: true }).click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/batches$/, { timeout: 10_000 });
});

// Bug: a run with no batches never finished loading its cultures. The cultures
// load was keyed on the batch ids, which are '' both while loading and when there
// are none, so it never re-ran once the (empty) batch list arrived.
test('a run with no batches says so', async ({ signedIn: page, lab }) => {
  seedBatchPages(lab);
  lab.runs.push({ id: 'run-2', account_id: lab.runs[0].account_id, code: 'SR-002', method: 'autoclave', psi: null, minutes: null, run_on: MADE_ON, notes: 'Lid left open', created_at: `${MADE_ON}T12:00:00Z` });
  const visible = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });

  await page.goto('/run/run-2');
  await expect(visible('SR-002').first()).toBeVisible({ timeout: 10_000 });
  await expect(visible('Autoclave · 11/23/26')).toBeVisible();
  await expect(visible('Lid left open')).toBeVisible();
  await expect(visible('No batches recorded for this run.')).toBeVisible();
  await expect(visible('Cultures made from it (0)')).toBeVisible();
  await expect(visible("None yet. Cultures show here once they're made on a batch from this run.")).toBeVisible();
  await expect(visible("No plates from this yet, or none scored (clean plates that were discarded don't count).")).toBeVisible();
});

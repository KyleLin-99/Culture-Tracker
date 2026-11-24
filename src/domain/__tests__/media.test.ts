import { describe, expect, it } from '@jest/globals';

import { batchSummary, KIND_LABEL, KINDS, METHOD_LABEL, METHODS, runSummary } from '../media';
import type { MediaBatch, SterilizationRun } from '../types';

const batch = (o: Partial<MediaBatch> = {}): MediaBatch => ({
  id: 'mb-1', account_id: 'a', code: 'MB-001', kind: 'agar', recipe: null, sterilization_run_id: 'r1', recipe_id: 'rc-2',
  volume_ml: 250, made_on: '2026-11-24', notes: null, created_at: '2026-11-24T10:00:00Z',
  sterilization_runs: { code: 'SR-001' }, recipes: { name: 'MEA 2%', version: 2, family_id: 'fam-mea' }, ...o,
});

const run = (o: Partial<SterilizationRun> = {}): SterilizationRun => ({
  id: 'r1', account_id: 'a', code: 'SR-001', method: 'pressure_cooker', psi: 15, minutes: 90, run_on: '2026-11-24',
  notes: null, created_at: '2026-11-24T09:00:00Z', ...o,
});

describe('labels', () => {
  it('names every method and kind', () => {
    expect(METHODS.map((m) => METHOD_LABEL[m.value])).toEqual(['Pressure cooker', 'Autoclave', 'Pasteurize', 'Other']);
    expect(KINDS.map((k) => KIND_LABEL[k.value])).toEqual(['Agar', 'Liquid culture', 'Other']);
  });
});

describe('batchSummary', () => {
  it('reads kind · recipe version · volume · date · run', () => {
    expect(batchSummary(batch())).toBe('Agar · MEA 2% v2 · 250 ml · 11/24/26 · SR-001');
  });

  it('leaves the run out on pages that show it separately', () => {
    expect(batchSummary(batch(), { withRun: false })).toBe('Agar · MEA 2% v2 · 250 ml · 11/24/26');
  });

  it('shows litres, a free-text recipe, and skips what was not recorded', () => {
    expect(batchSummary(batch({ volume_ml: 1500 }))).toContain(' · 1.5 L · ');
    expect(
      batchSummary(batch({ kind: 'lc', recipe: 'Honey', recipes: null, volume_ml: null, sterilization_runs: null, sterilization_run_id: null })),
    ).toBe('Liquid culture · Honey · 11/24/26');
  });
});

describe('runSummary', () => {
  it('reads method · psi · minutes · date', () => {
    expect(runSummary(run())).toBe('Pressure cooker · 15 psi · 90 min · 11/24/26');
  });

  it('skips psi and minutes when not recorded, and never includes notes', () => {
    expect(runSummary(run({ method: 'pasteurize', psi: null, minutes: null, notes: 'lid leaked' }))).toBe('Pasteurize · 11/24/26');
  });
});

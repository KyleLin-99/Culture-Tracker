import { describe, expect, it } from '@jest/globals';

import { batchKindFor, describeRow, formatP, formatRisk, strength } from '../trace';
import type { TraceRow } from '../types';

// The SR-002 example from supabase/tests/database/03_lab_records.test.sql.
const sr002: TraceRow = {
  factor: 'sterilization_run',
  factor_id: 'x',
  label: 'SR-002',
  contaminated_with: 4,
  clean_with: 1,
  contaminated_total: 5,
  clean_total: 12,
  rate_with: 0.8,
  rate_without: 0.083,
  relative_risk: 9.6,
  p_value: 0.00986,
};

describe('strength', () => {
  it('calls a rare, large effect a strong lead', () => {
    expect(strength(sr002)).toBe('strong');
  });
  it('calls a borderline effect possible', () => {
    expect(strength({ p_value: 0.05, relative_risk: 3 })).toBe('possible');
  });
  it('calls chance-level or protective effects weak', () => {
    expect(strength({ p_value: 0.4, relative_risk: 2 })).toBe('weak');
    expect(strength({ p_value: 0.005, relative_risk: 0.5 })).toBe('weak');
  });
});

describe('formatting', () => {
  it('formats p values', () => {
    expect(formatP(0.00986)).toBe('p = 0.010');
    expect(formatP(0.0004)).toBe('p < 0.001');
    expect(formatP(1)).toBe('p = 1.00');
  });
  it('formats relative risk', () => {
    expect(formatRisk(9.6)).toBe('9.6× the risk');
    expect(formatRisk(12.4)).toBe('12× the risk');
    expect(formatRisk(0.61)).toBe('0.6× the risk (lower)');
  });
  it('describes a row in lab terms', () => {
    expect(describeRow(sr002)).toBe('4 of 5 with SR-002 contaminated (80%) · 1 of 12 without (8%)');
  });
  it('words a day as "made <date>"', () => {
    expect(describeRow({ ...sr002, factor: 'made_on', label: '2026-11-23' })).toBe(
      '4 of 5 made 11/23/26 contaminated (80%) · 1 of 12 without (8%)',
    );
  });
  it('says when every plate shares the cause', () => {
    const all: TraceRow = { ...sr002, label: 'S-1', contaminated_with: 5, clean_with: 12, rate_with: 5 / 17 };
    expect(describeRow(all)).toBe('5 of 17 with S-1 contaminated (29%) · every plate in this window shares it');
  });
});

describe('batchKindFor', () => {
  it('matches transfers to the right kind of media batch', () => {
    expect(batchKindFor('agar')).toBe('agar');
    expect(batchKindFor('slant')).toBe('agar');
    expect(batchKindFor('lc')).toBe('lc');
    expect(batchKindFor('other')).toBeNull();
  });
});

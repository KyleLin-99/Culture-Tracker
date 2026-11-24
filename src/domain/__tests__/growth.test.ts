import { describe, expect, it } from '@jest/globals';

import { daysBetween, formatRate, growth, type Growth, rateOf, vigor, type VigorRow } from '../growth';

const check = (checked_on: string, percent: number | null, radius_mm: number | null = null) => ({ checked_on, percent, radius_mm });

describe('growth', () => {
  it('counts whole days, across a month end', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
  });

  it('turns one check into a rough rate from the day the culture was made', () => {
    expect(growth('2026-11-01', [check('2026-11-05', 20, 12)])).toEqual({
      mmPerDay: 3, percentPerDay: 5, daysToFull: null, checks: 1,
    });
  });

  it('fits several checks (least squares from the start)', () => {
    // 2 mm/day exactly, then a noisy reading.
    const g = growth('2026-11-01', [check('2026-11-03', null, 4), check('2026-11-05', null, 8), check('2026-11-07', null, 13)]);
    expect(g.mmPerDay).toBeCloseTo(2.11, 2);
    expect(g.percentPerDay).toBeNull();
  });

  it('stops the percent rate at the first full plate, and reports days to full', () => {
    const g = growth('2026-11-01', [check('2026-11-11', 100), check('2026-11-06', 50), check('2026-11-20', 100)]);
    expect(g.percentPerDay).toBeCloseTo(10, 5);
    expect(g.daysToFull).toBe(10);
  });

  it('ignores a check on the day the culture was made', () => {
    expect(growth('2026-11-01', [check('2026-11-01', 5)]).percentPerDay).toBeNull();
  });
});

describe('vigor across generations', () => {
  const g = (mm: number | null, pct: number | null, checks = 2): Growth => ({ mmPerDay: mm, percentPerDay: pct, daysToFull: null, checks });
  const row = (code: string, generation: number, growth: Growth): VigorRow => ({ id: code, code, generation, growth });

  it('flags a culture growing well below its ancestors', () => {
    const v = vigor([row('S', 0, g(4, null)), row('S-2', 1, g(4.4, null))], row('S-2A', 2, g(2.6, null)))!;
    expect([v.metric, v.ancestorAverage, v.ratio, v.slow]).toEqual(['mmPerDay', 4.2, 0.62, true]);
    expect(v.rows.map((r) => r.rate)).toEqual([4, 4.4, 2.6]);
  });

  it('does not flag on a single check', () => {
    expect(vigor([row('S', 0, g(4, null))], row('S-2', 1, g(2, null, 1)))!.slow).toBe(false);
  });

  it('does not flag a small dip', () => {
    expect(vigor([row('S', 0, g(4, null))], row('S-2', 1, g(3, null)))!.slow).toBe(false);
  });

  it('compares on percent when this culture has no radius checks', () => {
    const v = vigor([row('S', 0, g(4, 12)), row('S-2', 1, g(null, null))], row('S-2A', 2, g(null, 6)))!;
    expect([v.metric, v.ancestorAverage, v.ratio, v.slow]).toEqual(['percentPerDay', 12, 0.5, true]);
  });

  it('has nothing to compare when ancestors were never checked, or this culture has no rate', () => {
    expect(vigor([row('S', 0, g(null, null))], row('S-2', 1, g(3, null)))).toMatchObject({ ancestorAverage: null, slow: false });
    expect(vigor([row('S', 0, g(4, null))], row('S-2', 1, g(null, null, 0)))).toBeNull();
  });

  it('prefers radius, falls back to percent, and formats rates', () => {
    expect(rateOf(g(null, 8))).toEqual({ metric: 'percentPerDay', value: 8 });
    expect(rateOf(g(3, 8))).toEqual({ metric: 'mmPerDay', value: 3 });
    expect(formatRate(3.25, 'mmPerDay')).toBe('3.3 mm/day');
    expect(formatRate(12, 'percentPerDay')).toBe('12 %/day');
  });
});

import { describe, expect, it } from '@jest/globals';

import { contaminationBy, growthByStrain, NOT_RECORDED, overall, sourceVsRest, sourceWindow, type StatsRow } from '../stats';

let n = 0;
const row = (o: Partial<StatsRow>): StatsRow => ({
  id: `i${(n += 1)}`, strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1,
  made_on: '2026-11-01', status: 'active', contaminated: false, batch_id: null, batch_code: null, run_id: null,
  run_code: null, recipe_family: null, recipe_name: null, ...o,
});

const mea = { batch_id: 'b1', batch_code: 'MB-001', run_id: 'r1', run_code: 'SR-001', recipe_family: 'f-mea', recipe_name: 'MEA 2%' };
const pda = { batch_id: 'b2', batch_code: 'MB-002', run_id: 'r1', run_code: 'SR-001', recipe_family: 'f-pda', recipe_name: 'PDA' };
const rows = [
  row({ ...mea, contaminated: true }),
  row({ ...mea, contaminated: true }),
  row({ ...mea }),
  row({ ...pda, generation: 2, made_on: '2026-10-15' }),
  row({ ...pda, generation: 2, made_on: '2026-10-20', contaminated: true }),
  row({ generation: 3, made_on: '2026-09-30' }), // nothing recorded
];

describe('contamination rates', () => {
  it('overall', () => {
    expect(overall(rows)).toEqual({ total: 6, contaminated: 3, rate: 0.5 });
    expect(overall([])).toEqual({ total: 0, contaminated: 0, rate: 0 });
  });

  it('by recipe: worst first, plates with no recipe last', () => {
    expect(contaminationBy(rows, 'recipe').map((g) => [g.label, g.contaminated, g.total, g.rate])).toEqual([
      ['MEA 2%', 2, 3, 0.667],
      ['PDA', 1, 2, 0.5],
      [NOT_RECORDED, 0, 1, 0],
    ]);
  });

  it('by run and batch', () => {
    expect(contaminationBy(rows, 'run').map((g) => [g.label, g.total])).toEqual([['SR-001', 5], [NOT_RECORDED, 1]]);
    expect(contaminationBy(rows, 'batch').map((g) => g.label)).toEqual(['MB-001', 'MB-002', NOT_RECORDED]);
  });

  it('by generation and month, in order', () => {
    expect(contaminationBy(rows, 'generation').map((g) => [g.label, g.rate])).toEqual([['Gen 1', 0.667], ['Gen 2', 0.5], ['Gen 3', 0]]);
    expect(contaminationBy(rows, 'month').map((g) => [g.label, g.total])).toEqual([['Sep 2026', 1], ['Oct 2026', 2], ['Nov 2026', 3]]);
  });

  it('by strain: grouped by id, worst first, then more plates, then by name; never "Not recorded"', () => {
    const lion = (o: Partial<StatsRow> = {}) => row({ strain_id: 'lm', strain_name: "Lion's Mane", ...o });
    const king = (o: Partial<StatsRow> = {}) => row({ strain_id: 'ko', strain_name: 'King Oyster', ...o });
    // Two strains with the same name stay separate.
    const twin = row({ strain_id: 'bo-2', strain_name: 'Blue Oyster' });
    const out = contaminationBy([
      ...rows, // Blue Oyster: 3 of 6
      lion({ contaminated: true }), lion(), // 1 of 2
      king({ contaminated: true }), king(), king({ contaminated: true }), king(), // 2 of 4
      twin,
    ], 'strain');
    expect(out.map((g) => [g.key, g.label, g.contaminated, g.total, g.rate])).toEqual([
      ['bo', 'Blue Oyster', 3, 6, 0.5],
      ['ko', 'King Oyster', 2, 4, 0.5],
      ['lm', "Lion's Mane", 1, 2, 0.5],
      ['bo-2', 'Blue Oyster', 0, 1, 0],
    ]);
    // Same rate and size: alphabetical.
    expect(contaminationBy([lion(), king()], 'strain').map((g) => g.label)).toEqual(['King Oyster', "Lion's Mane"]);
  });

  it('orders generation 10 after 9', () => {
    expect(contaminationBy([row({ generation: 10 }), row({ generation: 9 })], 'generation').map((g) => g.label)).toEqual(['Gen 9', 'Gen 10']);
  });
});

describe('growth by strain', () => {
  it('averages growth over cultures with checks, by strain name', () => {
    const a = row({ made_on: '2026-11-01' });
    const b = row({ made_on: '2026-11-01' });
    const k = row({ strain_id: 'king', strain_name: 'king oyster', made_on: '2026-11-01' });
    const none = row({});
    const out = growthByStrain([a, b, k, none], [
      { item_id: a.id, checked_on: '2026-11-05', percent: 40, radius_mm: 12 },
      { item_id: a.id, checked_on: '2026-11-11', percent: 100, radius_mm: null },
      { item_id: b.id, checked_on: '2026-11-05', percent: 20, radius_mm: 8 },
      { item_id: k.id, checked_on: '2026-11-03', percent: null, radius_mm: 2 },
    ]);
    expect(out).toEqual([
      { strainId: 'bo', name: 'Blue Oyster', cultures: 2, mmPerDay: 2.5, percentPerDay: 7.5, daysToFull: 10, fullCount: 1 },
      { strainId: 'king', name: 'king oyster', cultures: 1, mmPerDay: 1, percentPerDay: null, daysToFull: null, fullCount: 0 },
    ]);
  });
});

// The batch and run pages compare plates from one source with the rest of the lab.
describe('sourceVsRest', () => {
  it('splits the rows into plates from the source and every other plate, no plate counted twice', () => {
    const out = sourceVsRest(rows, (r) => r.batch_id === 'b1');
    expect(out).toEqual({
      source: { total: 3, contaminated: 2, rate: 0.667 },
      rest: { total: 3, contaminated: 1, rate: 0.333 },
    });
    expect(out.source.total + out.rest.total).toBe(rows.length);
  });

  it('counts plates with no batch or run recorded as the rest of the lab', () => {
    // r1 covers both batches; only the plate with nothing recorded is left.
    expect(sourceVsRest(rows, (r) => r.run_id === 'r1')).toEqual({
      source: { total: 5, contaminated: 3, rate: 0.6 },
      rest: { total: 1, contaminated: 0, rate: 0 },
    });
  });

  it('reports zero plates (rate 0) when nothing came from the source or there is nothing else', () => {
    expect(sourceVsRest(rows, (r) => r.batch_id === 'nope').source).toEqual({ total: 0, contaminated: 0, rate: 0 });
    expect(sourceVsRest(rows, () => true).rest).toEqual({ total: 0, contaminated: 0, rate: 0 });
    expect(sourceVsRest([], () => true)).toEqual({ source: { total: 0, contaminated: 0, rate: 0 }, rest: { total: 0, contaminated: 0, rate: 0 } });
  });
});

describe('sourceWindow', () => {
  const FAR = '2099-01-01'; // a today far enough ahead that the window isn't cut short

  it('runs from 30 days before the source was made to 90 days after', () => {
    expect(sourceWindow('2026-06-15', FAR)).toEqual({ from: '2026-05-16', to: '2026-09-13' });
  });

  it('crosses month and year boundaries, short months and leap days', () => {
    expect(sourceWindow('2026-01-31', FAR)).toEqual({ from: '2026-01-01', to: '2026-05-01' });
    expect(sourceWindow('2026-03-01', FAR)).toEqual({ from: '2026-01-30', to: '2026-05-30' });
    expect(sourceWindow('2026-12-15', FAR)).toEqual({ from: '2026-11-15', to: '2027-03-15' });
    expect(sourceWindow('2028-02-29', FAR)).toEqual({ from: '2028-01-30', to: '2028-05-29' });
    expect(sourceWindow('2027-01-05', FAR).from).toBe('2026-12-06');
  });

  it('stops at today for a recent source', () => {
    expect(sourceWindow('2026-11-01', '2026-11-24')).toEqual({ from: '2026-10-02', to: '2026-11-24' });
    expect(sourceWindow('2026-11-24', '2026-11-24')).toEqual({ from: '2026-10-25', to: '2026-11-24' });
  });

  it('keeps the full 90 days once today is past them (the last day counts)', () => {
    expect(sourceWindow('2026-06-15', '2026-09-13')).toEqual({ from: '2026-05-16', to: '2026-09-13' });
    expect(sourceWindow('2026-06-15', '2026-09-14').to).toBe('2026-09-13');
  });

  it('never ends before the day the source was made, even if it is dated after today', () => {
    expect(sourceWindow('2026-11-30', '2026-11-24')).toEqual({ from: '2026-10-31', to: '2026-11-30' });
  });

  it('pads single-digit months and days', () => {
    const w = sourceWindow('2026-02-03', FAR);
    expect(w).toEqual({ from: '2026-01-04', to: '2026-05-04' });
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

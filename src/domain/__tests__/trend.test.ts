import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import type { StatsRow } from '../stats';
import {
  addDays,
  beforeAfter,
  bucketStart,
  contaminationTrend,
  defaultBucket,
  fisherTwoSided,
  MIN_PLATES,
} from '../trend';

let n = 0;
const row = (made_on: string, contaminated = false): StatsRow => ({
  id: `i${(n += 1)}`, strain_id: 'bo', strain_name: 'Blue Oyster', kind: 'transfer', medium: 'agar', generation: 1,
  made_on, status: 'active', contaminated, batch_id: null, batch_code: null, run_id: null,
  run_code: null, recipe_family: null, recipe_name: null,
});
/** `total` plates on `day`, the first `contaminated` of them contaminated. */
const plates = (day: string, total: number, contaminated: number) =>
  Array.from({ length: total }, (_, i) => row(day, i < contaminated));

describe('addDays', () => {
  it('moves across month and year ends, both ways', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-11-24', 0)).toBe('2026-11-24');
    expect(addDays('2026-11-24', -30)).toBe('2026-10-25');
  });
});

describe('bucketStart', () => {
  it('starts weeks on Monday: a Sunday belongs to the week before, a Monday starts its own', () => {
    expect(bucketStart('2026-11-23', 'week')).toBe('2026-11-23'); // Monday
    expect(bucketStart('2026-11-24', 'week')).toBe('2026-11-23'); // Tuesday
    expect(bucketStart('2026-11-29', 'week')).toBe('2026-11-23'); // Sunday
    expect(bucketStart('2026-11-30', 'week')).toBe('2026-11-30'); // next Monday
  });

  it('weeks can start in the month or year before', () => {
    expect(bucketStart('2026-12-02', 'week')).toBe('2026-11-30');
    expect(bucketStart('2027-01-01', 'week')).toBe('2026-12-28'); // a Friday
    expect(bucketStart('2027-01-03', 'week')).toBe('2026-12-28'); // a Sunday
  });

  it('starts months on the 1st', () => {
    expect(bucketStart('2026-11-01', 'month')).toBe('2026-11-01');
    expect(bucketStart('2026-11-30', 'month')).toBe('2026-11-01');
    expect(bucketStart('2026-12-31', 'month')).toBe('2026-12-01');
    expect(bucketStart('2028-02-29', 'month')).toBe('2028-02-01');
  });
});

// Dates are built from local parts, so a day that's 23 or 25 hours long, or one
// whose midnight doesn't exist, must not shift a date. Jest's process.env is a
// copy, so setting TZ inside a test does nothing: each zone runs in its own Node
// process (Node strips the types from trend.ts itself).
const TREND = path.resolve(__dirname, '../trend.ts');
const PROBE = `
  const t = await import(${JSON.stringify(pathToFileURL(TREND).href)});
  const weeks = (from, to) => t.contaminationTrend([], from, to, 'week').map((p) => p.start);
  console.log(JSON.stringify({
    offsets: [new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset()],
    addDays: [
      t.addDays('2026-03-07', 1), t.addDays('2026-03-08', 1), t.addDays('2026-10-25', 1),
      t.addDays('2026-09-05', 1), t.addDays('2026-09-06', 1), t.addDays('2026-03-15', -14),
      t.addDays('2026-04-05', -30),
    ],
    weekStarts: ['2026-03-08', '2026-03-09', '2026-03-29', '2026-10-25', '2026-09-06', '2026-10-04', '2026-04-05']
      .map((d) => t.bucketStart(d, 'week')),
    monthStart: t.bucketStart('2026-09-06', 'month'),
    north: weeks('2026-02-23', '2026-04-06'),
    chile: weeks('2026-08-24', '2026-09-14'),
    autumn: weeks('2026-10-19', '2026-11-02'),
  }));
`;

// US spring forward Sun 2026-03-08, UK Sun 2026-03-29 and back Sun 2026-10-25,
// Chile Sun 2026-09-06 (midnight is skipped), Sydney on Sun 2026-10-04 and off Sun 2026-04-05.
describe.each(['America/New_York', 'Europe/London', 'America/Santiago', 'Australia/Sydney', 'UTC'])('in %s', (tz) => {
  const run = () => {
    const out = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', PROBE], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    if (out.status !== 0) throw new Error(out.stderr);
    return JSON.parse(out.stdout);
  };

  it('keeps dates, week starts and weekly steps right across daylight-saving changes', () => {
    const r = run();
    expect(r.offsets[0] === r.offsets[1]).toBe(tz === 'UTC'); // really running in that zone
    expect(r.addDays).toEqual(['2026-03-08', '2026-03-09', '2026-10-26', '2026-09-06', '2026-09-07', '2026-03-01', '2026-03-06']);
    expect(r.weekStarts).toEqual(['2026-03-02', '2026-03-09', '2026-03-23', '2026-10-19', '2026-08-31', '2026-09-28', '2026-03-30']);
    expect(r.monthStart).toBe('2026-09-01');
    expect(r.north).toEqual(['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06']);
    expect(r.chile).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    expect(r.autumn).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });
});

describe('contaminationTrend', () => {
  it('counts plates per Monday week, with a Sunday plate in the week before', () => {
    const rows = [
      ...plates('2026-11-16', 2, 1), // Monday
      ...plates('2026-11-22', 2, 0), // Sunday, same week
      ...plates('2026-11-23', 3, 3), // Monday, next week
    ];
    expect(contaminationTrend(rows, '2026-11-16', '2026-11-24', 'week')).toEqual([
      { start: '2026-11-16', label: '11/16', total: 4, contaminated: 1, rate: 0.25 },
      { start: '2026-11-23', label: '11/23', total: 3, contaminated: 3, rate: 1 },
    ]);
  });

  it('includes empty buckets with a null rate (not 0), oldest first', () => {
    const rows = [...plates('2026-11-02', 2, 1), ...plates('2026-11-17', 1, 0)];
    const t = contaminationTrend(rows, '2026-11-01', '2026-11-24', 'week');
    expect(t.map((p) => [p.start, p.total, p.rate])).toEqual([
      ['2026-10-26', 0, null], // the 1st is a Sunday: its week starts in October
      ['2026-11-02', 2, 0.5],
      ['2026-11-09', 0, null],
      ['2026-11-16', 1, 0],
      ['2026-11-23', 0, null],
    ]);
  });

  it('a bucket with plates but none contaminated has rate 0', () => {
    expect(contaminationTrend(plates('2026-11-24', 4, 0), '2026-11-24', '2026-11-24', 'week')[0].rate).toBe(0);
  });

  it('rounds rates to 3 places', () => {
    expect(contaminationTrend(plates('2026-11-24', 3, 1), '2026-11-24', '2026-11-24', 'week')[0].rate).toBe(0.333);
  });

  it('buckets by month across a year end, with short labels', () => {
    const rows = [...plates('2026-11-30', 2, 2), ...plates('2026-12-01', 1, 0), ...plates('2027-01-31', 4, 1)];
    expect(contaminationTrend(rows, '2026-11-15', '2027-02-02', 'month')).toEqual([
      { start: '2026-11-01', label: 'Nov 26', total: 2, contaminated: 2, rate: 1 },
      { start: '2026-12-01', label: 'Dec 26', total: 1, contaminated: 0, rate: 0 },
      { start: '2027-01-01', label: 'Jan 27', total: 4, contaminated: 1, rate: 0.25 },
      { start: '2027-02-01', label: 'Feb 27', total: 0, contaminated: 0, rate: null },
    ]);
  });

  it('leaves out plates outside the buckets', () => {
    const rows = [...plates('2026-10-01', 5, 5), ...plates('2026-11-24', 1, 0), ...plates('2026-12-07', 5, 5)];
    const t = contaminationTrend(rows, '2026-11-23', '2026-11-29', 'week');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ total: 1, contaminated: 0 });
  });

  it('keeps a plate made on `to` but nothing from the bucket after it', () => {
    const t = contaminationTrend(plates('2026-11-30', 1, 1), '2026-11-23', '2026-11-30', 'week');
    expect(t.map((p) => [p.start, p.total])).toEqual([['2026-11-23', 0], ['2026-11-30', 1]]);
  });

  it('has one bucket when from and to fall in the same week', () => {
    expect(contaminationTrend([], '2026-11-24', '2026-11-26', 'week').map((p) => p.start)).toEqual(['2026-11-23']);
  });
});

describe('defaultBucket', () => {
  it('uses weeks for up to 120 days, months beyond', () => {
    expect(defaultBucket(30)).toBe('week');
    expect(defaultBucket(90)).toBe('week');
    expect(defaultBucket(120)).toBe('week');
    expect(defaultBucket(121)).toBe('month');
    expect(defaultBucket(365)).toBe('month');
  });
});

describe('fisherTwoSided', () => {
  // Known values (R's fisher.test, two-sided).
  it('matches known values', () => {
    expect(fisherTwoSided(1, 9, 11, 3)).toBeCloseTo(0.002759, 5);
    expect(fisherTwoSided(3, 1, 1, 3)).toBeCloseTo(0.4857, 4);
    expect(fisherTwoSided(0, 10, 10, 0)).toBeCloseTo(1.0825e-5, 8);
    expect(fisherTwoSided(2, 8, 5, 5)).toBeCloseTo(0.3498, 4);
  });

  it('is 1 when the rows are identical, and never above 1', () => {
    const tables: [number, number, number, number][] = [[5, 5, 5, 5], [0, 10, 0, 10], [0, 0, 0, 0], [3, 7, 3, 7]];
    for (const [a, b, c, d] of tables) {
      const p = fisherTwoSided(a, b, c, d);
      expect(p).toBeCloseTo(1, 10); // floating-point sums can land a hair under 1
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('does not depend on which row or column comes first', () => {
    const p = fisherTwoSided(1, 9, 11, 3);
    expect(fisherTwoSided(11, 3, 1, 9)).toBeCloseTo(p, 12); // rows swapped
    expect(fisherTwoSided(9, 1, 3, 11)).toBeCloseTo(p, 12); // columns swapped
    expect(fisherTwoSided(1, 11, 9, 3)).toBeCloseTo(p, 12); // transposed
  });

  it('stays finite and between 0 and 1 for big tables', () => {
    const p = fisherTwoSided(40, 460, 90, 410);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-4);
  });
});

describe('beforeAfter', () => {
  const CHANGE = '2026-10-15';
  const TODAY = '2026-11-24';

  it('compares the 30 days before (the day before inclusive) with the change day through 29 days after', () => {
    const rows = [
      row('2026-09-14', true), // 31 days before: out
      row('2026-09-15', true), // 30 days before: in
      row('2026-10-14', false), // day before: before
      row('2026-10-15', true), // the day itself: after
      row('2026-11-13', false), // 29 days after: in
      row('2026-11-14', true), // 30 days after: out
    ];
    const c = beforeAfter(rows, CHANGE, TODAY);
    expect(c.before).toEqual({ from: '2026-09-15', to: '2026-10-14', total: 2, contaminated: 1, rate: 0.5 });
    expect(c.after).toEqual({ from: '2026-10-15', to: '2026-11-13', total: 2, contaminated: 1, rate: 0.5 });
  });

  it('ends the after side today for a recent change', () => {
    const c = beforeAfter([row('2026-11-20'), row('2026-11-25', true)], '2026-11-10', TODAY);
    expect(c.after).toMatchObject({ from: '2026-11-10', to: TODAY, total: 1, contaminated: 0 });
  });

  it('takes a custom window', () => {
    const c = beforeAfter([], CHANGE, TODAY, 7);
    expect([c.before.from, c.before.to, c.after.from, c.after.to]).toEqual(['2026-10-08', '2026-10-14', '2026-10-15', '2026-10-21']);
  });

  it(`says too_few with under ${MIN_PLATES} plates on either side, and gives no p-value`, () => {
    const four = beforeAfter([...plates('2026-10-01', 4, 4), ...plates('2026-10-20', 20, 0)], CHANGE, TODAY);
    expect(four).toMatchObject({ verdict: 'too_few', pValue: null });
    const fourAfter = beforeAfter([...plates('2026-10-01', 20, 20), ...plates('2026-10-20', 4, 0)], CHANGE, TODAY);
    expect(fourAfter).toMatchObject({ verdict: 'too_few', pValue: null });
    const none = beforeAfter([], CHANGE, TODAY);
    expect(none).toMatchObject({ verdict: 'too_few', pValue: null });
    expect(none.before.rate).toBeNull();
    expect(none.after.rate).toBeNull();
  });

  it('compares once both sides have exactly 5 plates', () => {
    const c = beforeAfter([...plates('2026-10-01', 5, 5), ...plates('2026-10-20', 5, 0)], CHANGE, TODAY);
    expect(c.verdict).toBe('better');
    expect(c.pValue).toBeCloseTo(0.007937, 5); // fisher(0,5,5,0)
  });

  it('says better when contamination fell and p < 0.05', () => {
    // Before 11/14 contaminated, after 1/10: the (1,9,11,3) table.
    const c = beforeAfter([...plates('2026-10-01', 14, 11), ...plates('2026-10-20', 10, 1)], CHANGE, TODAY);
    expect(c.verdict).toBe('better');
    expect(c.pValue).toBeCloseTo(0.002759, 5);
    expect(c.before.rate).toBe(0.786);
    expect(c.after.rate).toBe(0.1);
  });

  it('says worse when contamination rose and p < 0.05', () => {
    const c = beforeAfter([...plates('2026-10-01', 10, 1), ...plates('2026-10-20', 14, 11)], CHANGE, TODAY);
    expect(c.verdict).toBe('worse');
    expect(c.pValue).toBeCloseTo(0.002759, 5);
  });

  it('says unclear when the difference could be chance', () => {
    const c = beforeAfter([...plates('2026-10-01', 10, 5), ...plates('2026-10-20', 10, 2)], CHANGE, TODAY);
    expect(c.verdict).toBe('unclear');
    expect(c.pValue).toBeGreaterThanOrEqual(0.05);
  });

  it('says unclear when nothing changed', () => {
    const c = beforeAfter([...plates('2026-10-01', 8, 2), ...plates('2026-10-20', 8, 2)], CHANGE, TODAY);
    expect(c.verdict).toBe('unclear');
    expect(c.pValue).toBeCloseTo(1, 10);
  });
});

// Contamination over time, and whether a change in technique made a difference.
// Pure functions over stats rows (src/domain/stats.ts), so web and phone agree.

import type { StatsRow } from './stats';

export type Bucket = 'week' | 'month';

export type TrendPoint = {
  /** First day of the week (Monday) or month, YYYY-MM-DD. */
  start: string;
  label: string;
  total: number;
  contaminated: number;
  /** Null when no plates were made then. */
  rate: number | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The day `days` after (or before, if negative) an ISO date. */
export function addDays(date: string, days: number): string {
  const d = parse(date);
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** First day of the bucket holding `date`: Monday for weeks, the 1st for months. */
export function bucketStart(date: string, bucket: Bucket): string {
  const d = parse(date);
  if (bucket === 'month') return iso(new Date(d.getFullYear(), d.getMonth(), 1));
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}

function next(start: string, bucket: Bucket): string {
  const d = parse(start);
  return iso(bucket === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
}

function label(start: string, bucket: Bucket): string {
  const d = parse(start);
  return bucket === 'month' ? `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Contamination per week or month from `from` to `to`, every bucket included
 * (empty ones have a null rate), oldest first.
 */
export function contaminationTrend(rows: StatsRow[], from: string, to: string, bucket: Bucket): TrendPoint[] {
  const points = new Map<string, TrendPoint>();
  for (let s = bucketStart(from, bucket); s <= to; s = next(s, bucket)) {
    points.set(s, { start: s, label: label(s, bucket), total: 0, contaminated: 0, rate: null });
  }
  for (const r of rows) {
    const p = points.get(bucketStart(r.made_on, bucket));
    if (!p) continue;
    p.total += 1;
    if (r.contaminated) p.contaminated += 1;
  }
  return [...points.values()].map((p) => ({ ...p, rate: p.total ? Math.round((p.contaminated / p.total) * 1000) / 1000 : null }));
}

/** Weeks for up to 120 days, months beyond. */
export const defaultBucket = (days: number): Bucket => (days <= 120 ? 'week' : 'month');

// --- Before and after -----------------------------------------------------------

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i += 1) s += Math.log(i);
  return s;
}

/**
 * Two-sided Fisher's exact test on a 2×2 table: [a b; c d]. The chance of a split
 * at least this uneven if the rows didn't really differ.
 */
export function fisherTwoSided(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  const lf = (k: number) => logFactorial(k);
  const base = lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n);
  const prob = (x: number) => Math.exp(base - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x));
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x += 1) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

export type Side = { from: string; to: string; total: number; contaminated: number; rate: number | null };

export type Comparison = {
  before: Side;
  after: Side;
  pValue: number | null;
  /**
   * too_few: under 5 plates on a side. better / worse: the rate changed and a
   * difference that big would be unlikely by chance (p < 0.05). unclear: otherwise.
   */
  verdict: 'too_few' | 'better' | 'worse' | 'unclear';
};

/** Minimum plates on each side before comparing. */
export const MIN_PLATES = 5;

/**
 * Plates made in the `days` before a change against those made from that day
 * through `days` after it (not past `today`).
 */
export function beforeAfter(rows: StatsRow[], changedOn: string, today: string, days = 30): Comparison {
  const side = (from: string, to: string): Side => {
    const inside = rows.filter((r) => r.made_on >= from && r.made_on <= to);
    const contaminated = inside.filter((r) => r.contaminated).length;
    return {
      from,
      to,
      total: inside.length,
      contaminated,
      rate: inside.length ? Math.round((contaminated / inside.length) * 1000) / 1000 : null,
    };
  };
  const afterEnd = addDays(changedOn, days - 1);
  const before = side(addDays(changedOn, -days), addDays(changedOn, -1));
  const after = side(changedOn, afterEnd < today ? afterEnd : today);
  if (before.total < MIN_PLATES || after.total < MIN_PLATES) return { before, after, pValue: null, verdict: 'too_few' };
  const pValue = fisherTwoSided(
    after.contaminated,
    after.total - after.contaminated,
    before.contaminated,
    before.total - before.contaminated,
  );
  const verdict = pValue >= 0.05 ? 'unclear' : after.rate! < before.rate! ? 'better' : 'worse';
  return { before, after, pValue, verdict };
}

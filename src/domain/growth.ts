// Growth from colonization checks, and senescence: a culture growing clearly
// slower than its ancestors did. Pure functions, so web and phones (which read
// checks from their local copy) always agree.

import type { ColonizationCheck } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from a (YYYY-MM-DD) to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * Least-squares slope through the origin: the culture starts at 0 on the day it
 * was made, so one check already gives a rate, and more checks steady it.
 */
function slopeFromStart(points: { day: number; value: number }[]): number | null {
  const usable = points.filter((p) => p.day > 0);
  if (!usable.length) return null;
  const sxy = usable.reduce((s, p) => s + p.day * p.value, 0);
  const sxx = usable.reduce((s, p) => s + p.day * p.day, 0);
  return sxy / sxx;
}

/** Percent rises until the plate is full; points after the first 100% would drag the rate down. */
function untilFull(points: { day: number; value: number }[]) {
  const full = points.findIndex((p) => p.value >= 100);
  return full === -1 ? points : points.slice(0, full + 1);
}

export type Growth = {
  /** Colony radius growth in mm/day, from radius checks. */
  mmPerDay: number | null;
  /** Plate coverage growth in %/day, from percent checks (until full). */
  percentPerDay: number | null;
  /** Days from made to the first check at 100%. */
  daysToFull: number | null;
  /** How many checks the rates come from. */
  checks: number;
};

export function growth(madeOn: string, checks: Pick<ColonizationCheck, 'checked_on' | 'percent' | 'radius_mm'>[]): Growth {
  const sorted = [...checks].sort((a, b) => a.checked_on.localeCompare(b.checked_on));
  const radius = sorted
    .filter((c) => c.radius_mm !== null)
    .map((c) => ({ day: daysBetween(madeOn, c.checked_on), value: Number(c.radius_mm) }));
  const percent = untilFull(
    sorted.filter((c) => c.percent !== null).map((c) => ({ day: daysBetween(madeOn, c.checked_on), value: Number(c.percent) })),
  );
  const full = percent.find((p) => p.value >= 100);
  return {
    mmPerDay: round(slopeFromStart(radius)),
    percentPerDay: round(slopeFromStart(percent)),
    daysToFull: full ? full.day : null,
    checks: sorted.length,
  };
}

const round = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);

export type Metric = 'mmPerDay' | 'percentPerDay';
export const METRIC_UNIT: Record<Metric, string> = { mmPerDay: 'mm/day', percentPerDay: '%/day' };

/** The rate to compare: radius when measured (it's the steadier one), else percent. */
export function rateOf(g: Growth, prefer?: Metric): { metric: Metric; value: number } | null {
  const order: Metric[] = prefer ? [prefer, prefer === 'mmPerDay' ? 'percentPerDay' : 'mmPerDay'] : ['mmPerDay', 'percentPerDay'];
  for (const m of order) if (g[m] !== null) return { metric: m, value: g[m]! };
  return null;
}

/** Slower than this share of the ancestors' average counts as losing vigor. */
export const SLOW_RATIO = 0.7;
/** One check is a rough rate; flag only on two or more. */
export const MIN_CHECKS_TO_FLAG = 2;

export type VigorRow = { id: string; code: string; generation: number; growth: Growth };

export type Vigor = {
  metric: Metric;
  /** Ancestors (oldest first) and this culture, each with its rate on the shared metric, if any. */
  rows: (VigorRow & { rate: number | null })[];
  /** Average rate of the ancestors that have one. */
  ancestorAverage: number | null;
  /** This culture's rate as a share of the ancestors' average (0.63 = 37% slower). */
  ratio: number | null;
  slow: boolean;
};

/**
 * Compares a culture with its ancestors on one metric (radius if this culture
 * has it, else percent). `ancestors` oldest first, `self` last.
 */
export function vigor(ancestors: VigorRow[], self: VigorRow): Vigor | null {
  const own = rateOf(self.growth);
  if (!own) return null;
  const rows = [...ancestors, self].map((r) => ({ ...r, rate: r.growth[own.metric] }));
  const rated = rows.slice(0, -1).filter((r) => r.rate !== null);
  const ancestorAverage = rated.length ? round(rated.reduce((s, r) => s + r.rate!, 0) / rated.length) : null;
  const ratio = ancestorAverage ? Math.round((own.value / ancestorAverage) * 100) / 100 : null;
  return {
    metric: own.metric,
    rows,
    ancestorAverage,
    ratio,
    slow: ratio !== null && ratio < SLOW_RATIO && self.growth.checks >= MIN_CHECKS_TO_FLAG,
  };
}

/** "3.2 mm/day" */
export const formatRate = (value: number, metric: Metric) => `${Number(value.toFixed(1))} ${METRIC_UNIT[metric]}`;

// Wording for the contamination trace. The statistics come from the
// contamination_trace() SQL function; this only turns them into sentences.

import { labelDate } from './cultureCode';
import type { MediaKind, Medium, TraceFactor, TraceRow } from './types';

export const FACTOR_LABEL: Record<TraceFactor, string> = {
  parent: 'Parent culture',
  media_batch: 'Media batch',
  sterilization_run: 'Sterilization run',
  made_on: 'Day made',
};

export type Strength = 'strong' | 'possible' | 'weak';

/**
 * How seriously to take a row. Strong: unlikely to be chance (p < 0.01) and at
 * least double the risk. Possible: p < 0.1 with raised risk. Everything else is weak.
 */
export function strength(row: Pick<TraceRow, 'p_value' | 'relative_risk'>): Strength {
  if (row.p_value < 0.01 && row.relative_risk >= 2) return 'strong';
  if (row.p_value < 0.1 && row.relative_risk > 1) return 'possible';
  return 'weak';
}

export const STRENGTH_LABEL: Record<Strength, string> = {
  strong: 'Strong lead',
  possible: 'Possible lead',
  weak: 'Weak signal',
};

/** 0.0098 -> "p = 0.010", 0.0004 -> "p < 0.001", 1 -> "p = 1.00" */
export function formatP(p: number): string {
  if (p < 0.001) return 'p < 0.001';
  if (p < 0.1) return `p = ${p.toFixed(3)}`;
  return `p = ${p.toFixed(2)}`;
}

/** 9.6 -> "9.6× the risk"; under 1 reads as lower risk. */
export function formatRisk(rr: number): string {
  if (rr >= 1) return `${rr >= 10 ? rr.toFixed(0) : rr.toFixed(1)}× the risk`;
  return `${rr.toFixed(1)}× the risk (lower)`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "4 of 5 with SR-002 contaminated (80%) · 1 of 12 without (8%)" */
export function describeRow(row: TraceRow): string {
  const withN = row.contaminated_with + row.clean_with;
  const withoutContam = row.contaminated_total - row.contaminated_with;
  const withoutN = withoutContam + (row.clean_total - row.clean_with);
  const subject = row.factor === 'made_on' ? `made ${labelDate(row.label)}` : `with ${row.label}`;
  const head = `${row.contaminated_with} of ${withN} ${subject} contaminated (${pct(row.rate_with)})`;
  if (withoutN === 0) return `${head} · every plate in this window shares it`;
  return `${head} · ${withoutContam} of ${withoutN} without (${pct(withoutContam / withoutN)})`;
}

/** Which media batches fit a transfer onto this medium. */
export function batchKindFor(medium: Medium): MediaKind | null {
  if (medium === 'agar' || medium === 'slant') return 'agar';
  if (medium === 'lc') return 'lc';
  return null; // any kind
}

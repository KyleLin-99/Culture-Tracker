// How batches and runs read in lists and on their own pages.

import { labelDate } from './cultureCode';
import { formatVolume, recipeLabel } from './recipes';
import type { MediaBatch, MediaKind, SterilizationMethod, SterilizationRun } from './types';

export const METHODS: { value: SterilizationMethod; label: string }[] = [
  { value: 'pressure_cooker', label: 'Pressure cooker' },
  { value: 'autoclave', label: 'Autoclave' },
  { value: 'pasteurize', label: 'Pasteurize' },
  { value: 'other', label: 'Other' },
];
export const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<SterilizationMethod, string>;

export const KINDS: { value: MediaKind; label: string }[] = [
  { value: 'agar', label: 'Agar' },
  { value: 'lc', label: 'Liquid culture' },
  { value: 'other', label: 'Other' },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<MediaKind, string>;

/** Agar · MEA 2% v2 · 250 ml · 11/24/26 · SR-001 */
export function batchSummary(b: MediaBatch, { withRun = true } = {}): string {
  return [
    KIND_LABEL[b.kind],
    b.recipes ? recipeLabel(b.recipes) : null,
    b.volume_ml ? formatVolume(b.volume_ml) : null,
    b.recipe,
    labelDate(b.made_on),
    withRun ? b.sterilization_runs?.code : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Pressure cooker · 15 psi · 90 min · 11/24/26 */
export function runSummary(r: SterilizationRun): string {
  return [METHOD_LABEL[r.method], r.psi ? `${r.psi} psi` : null, r.minutes ? `${r.minutes} min` : null, labelDate(r.run_on)]
    .filter(Boolean)
    .join(' · ');
}

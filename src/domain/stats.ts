// Lab stats from stats_rows() (or the phone's equivalent): contamination rates by
// what plates were made from, and growth by strain. Pure, so web and phone agree.

import { growth } from './growth';
import type { ColonizationCheck } from './types';

/** One transfer or backup in the period (see supabase/migrations/*_stats_rows.sql). */
export type StatsRow = {
  id: string;
  strain_id: string;
  strain_name: string;
  kind: string;
  medium: string;
  generation: number;
  made_on: string;
  status: string;
  contaminated: boolean;
  batch_id: string | null;
  batch_code: string | null;
  run_id: string | null;
  run_code: string | null;
  recipe_family: string | null;
  recipe_name: string | null;
};

export type Dimension = 'recipe' | 'run' | 'batch' | 'generation' | 'month' | 'strain';

export const DIMENSION_LABEL: Record<Dimension, string> = {
  recipe: 'Recipe',
  run: 'Sterilization run',
  batch: 'Media batch',
  generation: 'Generation',
  month: 'Month made',
  strain: 'Strain',
};

export type Group = { key: string; label: string; total: number; contaminated: number; rate: number };

export const NOT_RECORDED = 'Not recorded';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function keyOf(r: StatsRow, d: Dimension): { key: string; label: string } | null {
  switch (d) {
    case 'recipe':
      return r.recipe_family ? { key: r.recipe_family, label: r.recipe_name ?? NOT_RECORDED } : null;
    case 'run':
      return r.run_id ? { key: r.run_id, label: r.run_code ?? NOT_RECORDED } : null;
    case 'batch':
      return r.batch_id ? { key: r.batch_id, label: r.batch_code ?? NOT_RECORDED } : null;
    case 'generation':
      return { key: String(r.generation).padStart(3, '0'), label: `Gen ${r.generation}` };
    case 'month': {
      const [y, m] = r.made_on.split('-');
      return { key: `${y}-${m}`, label: `${MONTHS[Number(m) - 1]} ${y}` };
    }
    case 'strain':
      return { key: r.strain_id, label: r.strain_name };
  }
}

const pct = (a: number, n: number) => (n ? Math.round((a / n) * 1000) / 1000 : 0);

/** Contaminated share overall. */
export function overall(rows: StatsRow[]): { total: number; contaminated: number; rate: number } {
  const c = rows.filter((r) => r.contaminated).length;
  return { total: rows.length, contaminated: c, rate: pct(c, rows.length) };
}

/**
 * Contamination grouped by one dimension. Recipe, run and batch put plates with
 * none recorded in a last "Not recorded" group. Generation and month are in order;
 * the rest worst first.
 */
export function contaminationBy(rows: StatsRow[], d: Dimension): Group[] {
  const groups = new Map<string, Group>();
  let missing: Group | null = null;
  for (const r of rows) {
    const k = keyOf(r, d);
    const g = k
      ? (groups.get(k.key) ?? groups.set(k.key, { key: k.key, label: k.label, total: 0, contaminated: 0, rate: 0 }).get(k.key)!)
      : (missing ??= { key: '', label: NOT_RECORDED, total: 0, contaminated: 0, rate: 0 });
    g.total += 1;
    if (r.contaminated) g.contaminated += 1;
  }
  const list = [...groups.values()].map((g) => ({ ...g, rate: pct(g.contaminated, g.total) }));
  if (d === 'generation' || d === 'month') list.sort((a, b) => a.key.localeCompare(b.key));
  else list.sort((a, b) => b.rate - a.rate || b.total - a.total || a.label.localeCompare(b.label));
  if (missing) list.push({ ...missing, rate: pct(missing.contaminated, missing.total) });
  return list;
}

export type StrainGrowth = {
  strainId: string;
  name: string;
  /** Cultures with at least one check. */
  cultures: number;
  mmPerDay: number | null;
  percentPerDay: number | null;
  /** Average days to a full plate, over cultures that got there. */
  daysToFull: number | null;
  fullCount: number;
};

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

/** Average growth per strain from the period's cultures and their checks, by name. */
export function growthByStrain(rows: StatsRow[], checks: Pick<ColonizationCheck, 'item_id' | 'checked_on' | 'percent' | 'radius_mm'>[]): StrainGrowth[] {
  const byItem = new Map<string, typeof checks>();
  for (const c of checks) (byItem.get(c.item_id) ?? byItem.set(c.item_id, []).get(c.item_id)!).push(c);
  const byStrain = new Map<string, { name: string; g: ReturnType<typeof growth>[] }>();
  for (const r of rows) {
    const cs = byItem.get(r.id);
    if (!cs?.length) continue;
    (byStrain.get(r.strain_id) ?? byStrain.set(r.strain_id, { name: r.strain_name, g: [] }).get(r.strain_id)!).g.push(growth(r.made_on, cs));
  }
  return [...byStrain.entries()]
    .map(([strainId, { name, g }]) => {
      const full = g.map((x) => x.daysToFull).filter((x): x is number => x !== null);
      return {
        strainId,
        name,
        cultures: g.length,
        mmPerDay: avg(g.map((x) => x.mmPerDay).filter((x): x is number => x !== null)),
        percentPerDay: avg(g.map((x) => x.percentPerDay).filter((x): x is number => x !== null)),
        daysToFull: avg(full),
        fullCount: full.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

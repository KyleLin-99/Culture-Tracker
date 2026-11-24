// Recipes: picking the current version of each, and scaling amounts to a batch size.
// Saving and versioning rules live in save_recipe() (supabase/migrations/*_recipes.sql).

import type { Ingredient, MediaKind, Recipe } from './types';

export const KIND_LABEL: Record<MediaKind, string> = { agar: 'Agar', lc: 'Liquid culture', other: 'Other' };

/** The newest version of each recipe still in use, by name. */
export function currentRecipes(rows: Recipe[]): Recipe[] {
  const latest = new Map<string, Recipe>();
  for (const r of rows) {
    const seen = latest.get(r.family_id);
    if (!seen || r.version > seen.version) latest.set(r.family_id, r);
  }
  return [...latest.values()]
    .filter((r) => !r.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Rounds for the scale: whole numbers from 100 up, one decimal from 10, two below. */
export function roundAmount(x: number): number {
  const places = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/** Every amount multiplied by toMl / fromMl. */
export function scaleIngredients(ingredients: Ingredient[], fromMl: number, toMl: number): Ingredient[] {
  if (!(fromMl > 0) || !(toMl > 0)) return ingredients;
  const k = toMl / fromMl;
  return ingredients.map((i) => ({ ...i, amount: roundAmount(i.amount * k) }));
}

/** "20 g Malt extract" */
export const formatIngredient = (i: Ingredient) => `${i.amount} ${i.unit} ${i.name}`;

/** "1000 ml" -> "1 L" from a litre up. */
export function formatVolume(ml: number): string {
  return ml >= 1000 ? `${roundAmount(ml / 1000)} L` : `${roundAmount(ml)} ml`;
}

/** "MEA 2% v2" */
export const recipeLabel = (r: { name: string; version: number }) => `${r.name} v${r.version}`;

/**
 * Starting points for a new recipe. Common hobby proportions; edit them to match
 * what you actually use before saving.
 */
export const RECIPE_TEMPLATES: { name: string; kind: MediaKind; volume_ml: number; ingredients: Ingredient[] }[] = [
  {
    name: 'MEA 2%',
    kind: 'agar',
    volume_ml: 1000,
    ingredients: [
      { name: 'Light malt extract', amount: 20, unit: 'g' },
      { name: 'Agar', amount: 20, unit: 'g' },
      { name: 'Water', amount: 1000, unit: 'ml' },
    ],
  },
  {
    name: 'LME liquid culture 2%',
    kind: 'lc',
    volume_ml: 1000,
    ingredients: [
      { name: 'Light malt extract', amount: 20, unit: 'g' },
      { name: 'Water', amount: 1000, unit: 'ml' },
    ],
  },
];

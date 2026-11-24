import { describe, expect, it } from '@jest/globals';

import { currentRecipes, formatVolume, recipeLabel, roundAmount, scaleIngredients } from '../recipes';
import type { Recipe } from '../types';

const r = (family: string, version: number, name: string, deleted = false): Recipe => ({
  id: `${family}-${version}`, account_id: 'a', family_id: family, version, name, kind: 'agar', volume_ml: 500,
  ingredients: [], steps: null, created_at: '2026-11-23', deleted_at: deleted ? '2026-11-23' : null,
});

describe('currentRecipes', () => {
  it('keeps the newest version of each recipe, by name', () => {
    const out = currentRecipes([r('mea', 1, 'MEA'), r('mea', 3, 'MEA 2%'), r('mea', 2, 'MEA'), r('pda', 1, 'pda')]);
    expect(out.map(recipeLabel)).toEqual(['MEA 2% v3', 'pda v1']);
  });

  it('leaves out archived recipes', () => {
    expect(currentRecipes([r('mea', 1, 'MEA', true), r('mea', 2, 'MEA', true)])).toEqual([]);
  });
});

describe('scaling', () => {
  const mea = [
    { name: 'Malt extract', amount: 10, unit: 'g' },
    { name: 'Agar', amount: 10, unit: 'g' },
    { name: 'Nutritional yeast', amount: 0.5, unit: 'g' },
    { name: 'Water', amount: 500, unit: 'ml' },
  ];

  it('scales every amount to the batch size', () => {
    expect(scaleIngredients(mea, 500, 750).map((i) => i.amount)).toEqual([15, 15, 0.75, 750]);
  });

  it('rounds to amounts you can weigh', () => {
    expect(scaleIngredients(mea, 500, 333).map((i) => i.amount)).toEqual([6.66, 6.66, 0.33, 333]);
    expect([roundAmount(123.456), roundAmount(12.345), roundAmount(1.2345)]).toEqual([123, 12.3, 1.23]);
  });

  it('leaves amounts alone when a volume is missing', () => {
    expect(scaleIngredients(mea, 500, 0)).toBe(mea);
  });

  it('shows litres from 1000 ml up', () => {
    expect([formatVolume(500), formatVolume(1000), formatVolume(1500)]).toEqual(['500 ml', '1 L', '1.5 L']);
  });
});

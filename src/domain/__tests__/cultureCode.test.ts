// The database builds every culture code (supabase/migrations/*_culture_codes.sql).
// These tests pin the app's copy of the same rules, so the two can't drift apart.
// If you change a rule, change both and add a pgTAP test too.

import { describe, expect, it } from '@jest/globals';

import {
  labelDate,
  MAX_CODE_LENGTH,
  normalizeCode,
  positionLetters,
  roomLeft,
  transferCode,
} from '../cultureCode';

describe('positionLetters', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [26, 'Z'],
    [27, 'AA'],
    [28, 'AB'],
    [52, 'AZ'],
    [53, 'BA'],
    [702, 'ZZ'],
    [703, 'AAA'],
  ])('%i -> %s', (n, letters) => {
    expect(positionLetters(n)).toBe(letters);
  });
});

describe('transferCode', () => {
  it('starts a dash segment with a number off an origin', () => {
    expect(transferCode('S', 'origin', 2)).toBe('S-2');
    expect(transferCode('TBG2', 'origin', 1)).toBe('TBG2-1');
  });

  it('alternates: letter after a number, number after a letter', () => {
    expect(transferCode('S-2', 'transfer', 1)).toBe('S-2A');
    expect(transferCode('S-2A', 'transfer', 1)).toBe('S-2A1');
    expect(transferCode('S-2A1', 'transfer', 2)).toBe('S-2A1B');
    expect(transferCode('S-2A10', 'transfer', 3)).toBe('S-2A10C');
    expect(transferCode('S-2A', 'transfer', 12)).toBe('S-2A12');
  });

  it('starts a new dash segment when reviving from a backup', () => {
    expect(transferCode('S-2A1(2)', 'backup', 1)).toBe('S-2A1(2)-1');
  });

  it('matches the chain the database tests build', () => {
    // Same steps as supabase/tests/database/01_culture_codes.test.sql
    let code = 'TBG-1';
    for (let i = 0; i < 15; i += 1) code = transferCode(code, 'transfer', 1);
    expect(code).toBe('TBG-1A1A1A1A1A1A1A1A');
    expect(code).toHaveLength(MAX_CODE_LENGTH);
    expect(roomLeft(code)).toBe(0);
  });
});

describe('normalizeCode', () => {
  it('ignores spaces and case, like lookup_code()', () => {
    expect(normalizeCode(' s-2a1 (2) ')).toBe('S-2A1(2)');
    expect(normalizeCode('tbg - 1a')).toBe('TBG-1A');
  });
});

describe('labelDate', () => {
  it('formats an ISO date the way it goes on a label', () => {
    expect(labelDate('2026-11-16')).toBe('11/16/26');
    expect(labelDate('2027-01-05')).toBe('1/5/27');
  });
});
